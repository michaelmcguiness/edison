import assert from "node:assert/strict";
import test from "node:test";
import { demandReadableIdeaBrief } from "./demand-idea-art";
test("optional art failure cannot block reading or rewrite raw idea/cached editorial identity",()=>{
  const original={id:"constructed",headline:"Preserve the exact headline",sources:["s1"],art:{version:999,svg:"<script>bad</script>"}};
  const copy=structuredClone(original),readable=demandReadableIdeaBrief(original);
  assert.deepEqual(readable,{...original,art:null});assert.deepEqual(original,copy);
  for(const brief of [{headline:"No historical art"},{headline:"No selected art",art:null},
    {headline:"Validated art",art:{version:1,composition:"living-system",palette:"sage",variant:0}}]) assert.equal(demandReadableIdeaBrief(brief),brief);
});
