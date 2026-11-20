import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { FacePoint, FaceTelemetry } from '../types/game';

const MOUTH_CONTOUR_INDICES = [
  61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185,
];

const MODEL_LOCAL_URL = '/mediapipe/face_landmarker.task';
const MODEL_CDN_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

let consoleFilterInstalled = false;

function installMediaPipeInfoFilter() {
  if (consoleFilterInstalled || typeof console === 'undefined') return;
  consoleFilterInstalled = true;

  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const first = typeof args[0] === 'string' ? args[0] : '';
    if (
      first.startsWith('INFO: Created TensorFlow Lite') ||
      first.startsWith('INFO: Replacing') ||
      first.includes('Created TensorFlow Lite XNNPACK delegate for CPU')
    ) {
      console.info(...args);
      return;
    }
    originalError(...args);
  };
}

export class FaceTracker {
  private landmarker: FaceLandmarker | null = null;
  private isInitializing = false;
  private lastVideoTime = -1;

  private smoothMouth = 0;
  private smoothTilt = 0;
  private smoothSmile = 0;
  private tiltOffset = 0;

  public async init(): Promise<void> {
    if (this.landmarker || this.isInitializing) return;
    this.isInitializing = true;
    installMediaPipeInfoFilter();

    try {
      const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');

      const createWithModel = async (modelAssetPath: string, delegate: 'GPU' | 'CPU') => {
        return FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath,
            delegate,
          },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: true,
          minFaceDetectionConfidence: 0.5,
          minFacePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      };

      try {
        this.landmarker = await createWithModel(MODEL_LOCAL_URL, 'GPU');
      } catch {
        try {
          this.landmarker = await createWithModel(MODEL_LOCAL_URL, 'CPU');
        } catch {
          this.landmarker = await createWithModel(MODEL_CDN_URL, 'CPU');
        }
      }
    } finally {
      this.isInitializing = false;
    }
  }

  public isReady(): boolean {
    return this.landmarker !== null;
  }

  public recenterTilt() {
    this.tiltOffset += this.smoothTilt;
  }

  public resetFilters() {
    this.smoothMouth = 0;
    this.smoothTilt = 0;
    this.smoothSmile = 0;
    this.lastVideoTime = -1;
  }

  public processVideoFrame(video: HTMLVideoElement, nowMs: number): FaceTelemetry | null {
    if (!this.landmarker || video.readyState < 2 || video.videoWidth === 0) {
      return null;
    }

    if (video.currentTime === this.lastVideoTime) {
      return null;
    }
    this.lastVideoTime = video.currentTime;

    const result = this.landmarker.detectForVideo(video, nowMs);
    const landmarks = result.faceLandmarks?.[0];
    if (!landmarks || landmarks.length < 400) {
      this.smoothMouth *= 0.7;
      this.smoothTilt *= 0.7;
      this.smoothSmile *= 0.7;
      return {
        detected: false,
        mouthOpen: this.smoothMouth,
        headTilt: this.smoothTilt,
        smile: this.smoothSmile,
        mouthPoints: [],
        leftEye: null,
        rightEye: null,
        noseTip: null,
      };
    }

    const eyeRightAnat = landmarks[33];
    const eyeLeftAnat = landmarks[263];
    const upperInnerLip = landmarks[13];
    const lowerInnerLip = landmarks[14];
    const mouthLeftCorner = landmarks[61];
    const mouthRightCorner = landmarks[291];
    const noseTipLm = landmarks[1];

    const dx = eyeLeftAnat.x - eyeRightAnat.x;
    const dy = eyeRightAnat.y - eyeLeftAnat.y;
    const interOcular = Math.max(0.04, Math.hypot(dx, eyeLeftAnat.y - eyeRightAnat.y));

    const rawAngle = Math.atan2(dy, Math.max(0.02, dx));
    const normalizedTilt = Math.max(-1, Math.min(1, rawAngle / 0.58)) - this.tiltOffset;

    const lipGap = Math.max(0, lowerInnerLip.y - upperInnerLip.y);
    const geoMouth = Math.max(0, Math.min(1, (lipGap / interOcular - 0.04) * 2.2));

    // Geometric mouth width fallback in case blendshapes are sparse
    const mouthWidth = Math.hypot(mouthRightCorner.x - mouthLeftCorner.x, mouthRightCorner.y - mouthLeftCorner.y);
    const geoSmile = Math.max(0, Math.min(1, (mouthWidth / interOcular - 0.58) * 3.0));

    let jawOpenBlend = geoMouth;
    let smileBlend = geoSmile;
    const categories = result.faceBlendshapes?.[0]?.categories;
    if (categories) {
      let smileL = 0;
      let smileR = 0;
      for (const c of categories) {
        if (c.categoryName === 'jawOpen') jawOpenBlend = c.score;
        else if (c.categoryName === 'mouthSmileLeft') smileL = c.score;
        else if (c.categoryName === 'mouthSmileRight') smileR = c.score;
      }
      smileBlend = Math.max(geoSmile * 0.4, (smileL + smileR) * 0.5);
    }

    const rawMouth = Math.max(0, Math.min(1, jawOpenBlend * 0.65 + geoMouth * 0.45));

    this.smoothMouth = this.smoothMouth * 0.35 + rawMouth * 0.65;
    this.smoothTilt = this.smoothTilt * 0.45 + normalizedTilt * 0.55;
    this.smoothSmile = this.smoothSmile * 0.4 + smileBlend * 0.6;

    const mouthPoints: FacePoint[] = MOUTH_CONTOUR_INDICES.map((idx) => ({
      x: 1 - landmarks[idx].x,
      y: landmarks[idx].y,
    }));

    return {
      detected: true,
      mouthOpen: this.smoothMouth,
      headTilt: Math.max(-1, Math.min(1, this.smoothTilt)),
      smile: Math.max(0, Math.min(1, this.smoothSmile)),
      mouthPoints,
      leftEye: { x: 1 - eyeLeftAnat.x, y: eyeLeftAnat.y },
      rightEye: { x: 1 - eyeRightAnat.x, y: eyeRightAnat.y },
      noseTip: { x: 1 - noseTipLm.x, y: noseTipLm.y },
    };
  }

  public dispose() {
    if (this.landmarker) {
      this.landmarker.close();
      this.landmarker = null;
    }
  }
}
