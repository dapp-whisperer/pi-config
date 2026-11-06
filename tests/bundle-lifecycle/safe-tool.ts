import fs from "node:fs";
import { Type } from "@sinclair/typebox";
function stdin_default(pi) {
  pi.registerTool({ name: "lane_fixture", label: "Lane fixture", description: "Safe lane-only fixture", parameters: Type.Object({ fail: Type.Boolean() }), execute: async (_id, args) => {
    fs.appendFileSync(process.env.LIFECYCLE_TOOL_LOG, JSON.stringify(args) + "\n");
    if (args.fail) throw new Error("LANE_EXPECTED_TOOL_FAILURE");
    return { content: [{ type: "text", text: "LANE_TOOL_SUCCESS" }] };
  } });
}
export {
  stdin_default as default
};
