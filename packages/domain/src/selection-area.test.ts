import {describe,it,expect} from "vitest";
import {newLayer} from "./document";
import {anchor} from "./curves";
import {layerIntersectsArea,selectionAreaPolygon,SelectionArea} from "./selection-area";
const rect = (x:number,y:number,w=20,h=20) => ({...newLayer("rectangle","a",{x,y}),width:w,height:h});
const area = (kind:SelectionArea["kind"],x:number,y:number,ex:number,ey:number):SelectionArea => ({kind,start:{x,y},end:{x:ex,y:ey},points:[]});
describe("area intersection",()=>{
 it("detects containment and crossing even if the object center is outside",()=>{
  expect(layerIntersectsArea(rect(0,0,100,100),area("rectangle",40,40,50,50))).toBe(true);
  expect(layerIntersectsArea(rect(0,0,100,100),area("rectangle",95,95,110,110))).toBe(true);
  expect(layerIntersectsArea(rect(0,0),area("rectangle",40,40,50,50))).toBe(false);
 });
 it("uses circular distance from drag origin rather than its rectangular bounds",()=>{
  expect(layerIntersectsArea(rect(8,8,1,1),area("ellipse",0,0,10,0))).toBe(false);
  expect(layerIntersectsArea(rect(-8,-1,2,2),area("ellipse",0,0,10,0))).toBe(true);
  expect(selectionAreaPolygon(area("ellipse",0,0,6,8))[0]).toEqual({x:10,y:0});
 });
 it("honors freeform concavity and transformed contours",()=>{
  const lasso:SelectionArea={kind:"lasso",start:{x:0,y:0},end:{x:0,y:0},points:[{x:0,y:0},{x:100,y:0},{x:100,y:20},{x:20,y:20},{x:20,y:100},{x:0,y:100}]};
  expect(layerIntersectsArea(rect(50,50),lasso)).toBe(false);
  expect(layerIntersectsArea(rect(5,50),lasso)).toBe(true);
  expect(layerIntersectsArea({...rect(0,0,100,10),rotation:90},area("rectangle",45,-40,55,-30))).toBe(true);
 });
 it("crosses open paths and rejects guides, hidden and locked layers",()=>{
  const path={...rect(0,0,100,100),kind:"path" as const,curves:[{closed:false,nodes:[anchor({x:0,y:0}),anchor({x:100,y:100})]}]};
  expect(layerIntersectsArea(path,area("rectangle",48,48,52,52))).toBe(true);
  for(const patch of [{locked:true},{visible:false},{guide:"vertical" as const}]) expect(layerIntersectsArea({...rect(0,0),...patch},area("rectangle",0,0,20,20))).toBe(false);
 });
 it("respects compound path holes",()=>{
  const square=(a:number,b:number)=>({closed:true,nodes:[{x:a,y:a},{x:b,y:a},{x:b,y:b},{x:a,y:b}].map(anchor)});
  expect(layerIntersectsArea({...rect(0,0,100,100),kind:"path",curves:[square(0,100),square(20,80)]},area("rectangle",40,40,50,50))).toBe(false);
 });
});
