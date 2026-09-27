import { runDoctor } from "./setup.mts";

process.exitCode = await runDoctor({
  imageGaps: process.argv.includes("--image-gaps"),
});
