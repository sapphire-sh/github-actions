#!/usr/bin/env node

export const shouldPushImage = (eventName, pushImage) => eventName !== 'pull_request' && pushImage;

if (import.meta.filename === process.argv[1]) {
	process.stdout.write(`push=${shouldPushImage(process.env.EVENT_NAME, process.env.PUSH_IMAGE === 'true')}\n`);
}
