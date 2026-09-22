import { archViewHandler } from "../dist/lib/arch-tools.js";

const res = await archViewHandler(
  { port: 4321 },
  { projectRoot: process.cwd() }
);

console.log(res.content[0].text);
