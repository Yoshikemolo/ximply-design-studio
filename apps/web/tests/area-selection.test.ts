// @vitest-environment happy-dom
import "@angular/compiler";
import {beforeEach,describe,it,expect} from "vitest";
import {EditorService} from "../src/app/editor.service";
import {newLayer} from "../../../packages/domain/src/document";
const layer=(id:string,x:number,y=100)=>({...newLayer("rectangle",id,{x,y}),width:20,height:20});
function setup(){const e=new EditorService();e.document.update(d=>({...d,layers:[layer("a",100),layer("b",200)]}));return e;}
const ids=(e:EditorService)=>e.selectedLayers().map(l=>l.id);
beforeEach(()=>localStorage.clear());
describe("area selection gestures",()=>{
 it("uses last area mode for empty selection drag without document changes",()=>{
  const e=setup(),before=structuredClone(e.document()),revision=e.revision();
  e.start({x:90,y:90});e.move({x:130,y:130});e.end();
  expect(ids(e)).toEqual(["a"]);expect(e.document()).toEqual(before);expect(e.revision()).toBe(revision);expect(e.areaSelection()).toBeNull();
  e.lastAreaSelection.set("ellipse");e.start({x:175,y:110});e.move({x:220,y:110});e.end();expect(ids(e)).toEqual(["b"]);
 });
 it("explicit selection starts over objects and does not move them",()=>{
  const e=setup();e.tool.set("selectRectangle");e.start({x:105,y:105});e.move({x:230,y:130});e.end();expect(ids(e)).toEqual(["a","b"]);expect(e.document().layers[0].x).toBe(100);
 });
 it("Shift toggles against the initial selection, not previous preview frames",()=>{
  const e=setup();e.selectLayer("a");e.tool.set("selectRectangle");e.start({x:80,y:80},{shift:true});e.move({x:240,y:140},{shift:true});expect(ids(e)).toEqual(["b"]);e.move({x:241,y:141},{shift:true});e.end();expect(ids(e)).toEqual(["b"]);
 });
 it("selects group members together and excludes noneditable layers",()=>{
  const e=setup();e.document.update(d=>({...d,layers:[{...layer("a",100),groupPath:["g"]},{...layer("b",300),groupPath:["g","child"]},{...layer("locked",100),locked:true},{...layer("hidden",100),visible:false},{...layer("guide",100),guide:"vertical"}]}));
  e.start({x:80,y:80});e.move({x:130,y:130});e.end();expect(ids(e)).toEqual(["a","b"]);
 });
 it("cancel restores selection and nodes, click clears without drawing",()=>{
  const e=setup();e.selectLayer("b");e.activeNodes.set(["0:0"]);e.tool.set("selectLasso");e.start({x:90,y:90});e.move({x:140,y:90});e.move({x:140,y:140});e.move({x:90,y:140});expect(ids(e)).toEqual(["a"]);e.cancel();expect(ids(e)).toEqual(["b"]);expect(e.activeNodes()).toEqual(["0:0"]);expect(e.areaSelection()).toBeNull();
  e.start({x:0,y:0});e.end();expect(ids(e)).toEqual([]);expect(e.document().layers).toHaveLength(2);
 });
 it("preserves move behavior with the normal selection tool",()=>{
  const e=setup();e.start({x:110,y:110});e.move({x:150,y:110});e.end();expect(e.document().layers[0].x).toBe(140);
 });
});
