import { describe, expect, it } from "vitest";
import { blankDocument, newLayer, parseDocument, StudioDocument } from "../src/document";
import { blendCompatible, blendProgress, interpolateBlendLayer, interpolateBlendPaint, ObjectBlend, syncBlends, validateBlends } from "../src/object-blend";
import { polyline } from "../src/shapes";

function fixture(): StudioDocument {
  const back = { ...newLayer("rectangle","back",{x:10,y:20},"#ff0000","#000000",2),width:20,height:30,opacity:0.2,groupPath:["parent","blend","backGroup"] };
  const front = { ...newLayer("rectangle","front",{x:110,y:220},"#0000ff","#ffffff",6),width:40,height:50,opacity:0.8,groupPath:["parent","blend","frontGroup"] };
  const middle = { ...interpolateBlendLayer(back,front,0.5,"middle"),groupPath:["parent","blend","middle"] };
  const blend: ObjectBlend = {id:"definition",groupId:"blend",backIds:["back"],frontIds:["front"],stepIds:[["middle"]],steps:1,easing:"linear"};
  return syncBlends({...blankDocument(),layers:[back,middle,front],blends:[blend]});
}

describe("editable object blend geometry", () => {
  it("rejects procedural and dimension metadata in source and generated blend members", () => {
    for (const position of [0,1,2]) for (const key of ["dimension","procedural"] as const) {
      const document=fixture(),layer=document.layers[position];layer.kind="path";
      if(key==="procedural")layer.procedural={type:"pillar",shape:"rectangle",width:20,depth:30};
      else layer.dimension={kind:"linear",anchors:[{x:0,y:0},{x:20,y:0}],labelPosition:{x:10,y:10},text:"",format:{scale:1,unit:"px",decimals:0,separator:"."},extension:{stroke:"#000000",strokeWidth:1,gap:2,overshoot:4}};
      expect(()=>validateBlends(document)).toThrow();expect(()=>parseDocument(JSON.stringify(document))).toThrow();
    }
  });
  it("interpolates geometry, styles, transforms and real nested derived layers", () => {
    const doc=fixture(), middle=doc.layers[1];
    expect(middle).toMatchObject({id:"middle",kind:"path",x:60,y:120,width:30,height:40,fill:"#800080",stroke:"#808080",strokeWidth:4,opacity:0.5,groupPath:["parent","blend","middle"]});
    expect(middle.curves![0].nodes[2].point).toEqual({x:30,y:40});
    expect(parseDocument(JSON.stringify(doc))).toEqual(doc);
    expect(doc.layers[0].kind).toBe("rectangle");
  });
  it("uses premultiplied alpha to fade none without black fringes", () => {
    expect(interpolateBlendPaint("#ff0000","none",0.5)).toBe("#ff000080");
    expect(interpolateBlendPaint("none","#00ff0080",0.5)).toBe("#00ff0040");
    expect(interpolateBlendPaint("none","none",0.5)).toBe("none");
    expect(interpolateBlendPaint("#ff000080","#0000ff",0.5)).toBe("#5500aac0");
  });
  it("provides deterministic monotone easing with endpoint identities", () => {
    for(const easing of ["linear","ease-in","ease-out","ease-in-out"] as const){
      expect(blendProgress(0,easing)).toBe(0);expect(blendProgress(1,easing)).toBe(1);
      const positions=Array.from({length:101},(_,i)=>blendProgress(i/100,easing));
      expect(positions.every((value,index)=>!index||value>=positions[index-1])).toBe(true);
    }
    expect(blendProgress(0.25,"ease-in")).toBe(0.0625);
    expect(blendProgress(0.25,"ease-out")).toBe(0.4375);
    expect(blendProgress(0.25,"ease-in-out")).toBe(0.125);
    expect(()=>blendProgress(-1,"linear")).toThrow();
  });
  it("normalizes unequal contours by subdivision without flattening cubic handles", () => {
    const doc=fixture(), triangle={...doc.layers[0],kind:"path" as const,curves:[polyline([{x:0,y:0},{x:40,y:0},{x:0,y:40}],true)]};
    const result=interpolateBlendLayer(triangle,doc.layers[2],0,"normalized");
    expect(result.curves![0].nodes).toHaveLength(4);
    const points=result.curves![0].nodes.map(node=>node.point);
    const area=Math.abs(points.reduce((sum,p,i)=>sum+p.x*points[(i+1)%points.length].y-p.y*points[(i+1)%points.length].x,0))/2;
    expect(area).toBe(800);
    const ellipse={...doc.layers[2],kind:"ellipse" as const};
    const curved=interpolateBlendLayer(doc.layers[0],ellipse,0.5,"curved");
    expect(curved.curves![0].nodes.some(node=>node.outgoing.x!==node.point.x||node.outgoing.y!==node.point.y)).toBe(true);
  });
  it("uses short rotation and incorporates reflected control positions", () => {
    const doc=fixture(), back={...doc.layers[0],rotation:350,flipX:true},front={...doc.layers[2],rotation:10};
    const middle=interpolateBlendLayer(back,front,0.5,"m");
    expect(middle.rotation).toBe(0);
    expect(middle.flipX).toBe(false);
    expect(middle.curves![0].nodes[0].point.x).toBe(10);
  });
  it("regenerates stale intermediate geometry and preserves visibility and locks", () => {
    const doc=fixture();doc.layers[2].x=210;doc.layers[1].x=-999;doc.layers[1].locked=true;doc.layers[1].visible=false;
    const result=syncBlends(doc);
    expect(result.layers[1].x).toBe(110);
    expect(result.layers[1].id).toBe("middle");
    expect(result.layers[1].locked).toBe(true);expect(result.layers[1].visible).toBe(false);
    expect(result.layers[0]).toBe(doc.layers[0]);expect(result.layers[2]).toBe(doc.layers[2]);
    expect(parseDocument(JSON.stringify(doc))).toEqual(result);
  });
  it("rejects unsupported kinds, incompatible contours and bounded normalization excess", () => {
    const doc=fixture(),back=doc.layers[0],front=doc.layers[2];
    for(const layer of [{...front,kind:"text" as const},{...front,kind:"image" as const},{...front,guide:"vertical" as const},{...front,symbolId:"symbol"},{...front,kind:"path" as const,curves:[]},{...front,kind:"path" as const,curves:[polyline([{x:0,y:0},{x:5,y:5}])]},{...front,kind:"path" as const,curves:[polyline(Array.from({length:257},(_,x)=>({x,y:0})),true)]}]) expect(()=>blendCompatible([back],[layer])).toThrow();
    expect(()=>blendCompatible([back],[])).toThrow();
  });
  it("rejects dangling, overlapping, reordered and malformed native references", () => {
    const patches=[{steps:0},{steps:101},{easing:["linear"]},{stepIds:[]},{backIds:["missing"]},{frontIds:["back"]},{stepIds:[["back"]]},{extra:true}];
    for(const patch of patches){const doc=fixture();Object.assign(doc.blends![0],patch);expect(()=>parseDocument(JSON.stringify(doc))).toThrow();}
    const native1={...fixture(),version:1};expect(()=>parseDocument(JSON.stringify(native1))).toThrow();
    const duplicate=fixture();duplicate.blends!.push({...duplicate.blends![0],id:"other"});expect(()=>validateBlends(duplicate)).toThrow();
    const reordered=fixture();reordered.layers.reverse();expect(()=>validateBlends(reordered)).toThrow();
    const badGroup=fixture();badGroup.layers[1].groupPath=["parent","blend","wrong"];expect(()=>validateBlends(badGroup)).toThrow();
    const extra=fixture();extra.layers.push({...extra.layers[0],id:"extra"});expect(()=>validateBlends(extra)).toThrow();
  });
});
