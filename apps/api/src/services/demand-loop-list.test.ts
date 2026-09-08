import assert from "node:assert/strict";
import test from "node:test";
import { decodeDemandLoopCursor, encodeDemandLoopCursor } from "./demand-loop-list";
test("loop cursor is canonical-reader bound and cannot reinterpret foreign or malformed anchors",()=>{
  const owner="11111111-1111-4111-8111-111111111111",other="22222222-2222-4222-8222-222222222222",anchor="33333333-3333-4333-8333-333333333333";
  const cursor=encodeDemandLoopCursor(owner,anchor);
  assert.equal(decodeDemandLoopCursor(cursor,owner).anchorId,anchor);
  for(const value of [cursor+"=","not-json",Buffer.from(JSON.stringify({version:1,workspaceId:owner,anchorId:anchor,unsafe:true})).toString("base64url")]) assert.throws(()=>decodeDemandLoopCursor(value,owner));
  assert.throws(()=>decodeDemandLoopCursor(cursor,other));
});
