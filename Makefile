.PHONY: setup dev check clean

setup:
	npm install

dev:
	npm run dev

check:
	npm run lint
	npm test
	npm run build

clean:
	rm -rf dist server.js
