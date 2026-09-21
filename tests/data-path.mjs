import { homedir } from "node:os";
import { join } from "node:path";

// Research images are deliberately not distributed with the source.
export const microscopyData = process.env.SCLERITE_TEST_DATA || join(homedir(), "Downloads", "MR0145");
export const microscopyFile = name => join(microscopyData, name);
