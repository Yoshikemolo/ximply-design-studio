// @vitest-environment happy-dom
import '@angular/compiler';
import { signal } from '@angular/core';
import { beforeEach, expect, it, vi } from 'vitest';
import { AppComponent } from '../src/app/app.component';
import { PreferencesService } from '../src/app/preferences.service';
import { TOOL_FAMILIES, TOOLS } from '../src/app/tools';
let app:AppComponent;
let tool:ReturnType<typeof signal<string>>;
let updateDefaults:ReturnType<typeof vi.fn>, updateSelected:ReturnType<typeof vi.fn>;
const input=(value:number|string)=>({target:{value:String(value)}}) as unknown as Event;
const door={type:'door',width:120,depth:16,leafWidths:[40,80],operation:'swing',swing:'left',openingAngle:90};
beforeEach(()=>{
 localStorage.clear();tool=signal('door');updateDefaults=vi.fn();updateSelected=vi.fn();
 app=Object.create(AppComponent.prototype) as AppComponent;
 Object.assign(app,{preferences:new PreferencesService(),editor:{tool,proceduralDefaults:()=>({door,wall:{type:'wall',start:{x:0,y:0},end:{x:100,y:0},thickness:16},pillar:{type:'pillar',shape:'circle',width:60,depth:60}}),selected:()=>({procedural:door}),updateProceduralDefaults:updateDefaults,updateProcedural:updateSelected}});
});
it('uses five distinct architecture tools and wall as initial family tool',()=>{
 const family=TOOL_FAMILIES.find(f=>f.id==='architecture')!;expect(family.tools).toEqual(['wall','door','window','pillar','stair']);expect(TOOLS.filter(t=>family.tools.includes(t.id))).toHaveLength(5);
});
it('preserves leaf proportions when resizing total width in display units',()=>{
 app.preferences.setMeasurement('distanceUnit','in');app.setProceduralNumber('width',input(2.5));
 expect(updateDefaults).toHaveBeenCalledWith('door',{width:240,leafWidths:[80,160]});expect(updateSelected).not.toHaveBeenCalled();
});
it('updates individual leaf width and total width on a selected opening',()=>{
 tool.set('select');app.setProceduralLeafWidth(0,input(30));expect(updateSelected).toHaveBeenCalledWith({width:110,leafWidths:[30,80]});expect(updateDefaults).not.toHaveBeenCalled();
});
it('enforces leaf count and keeps circular pillar footprint equal',()=>{
 app.setProceduralLeafCount(input(5));expect(updateDefaults).not.toHaveBeenCalled();
 app.setProceduralLeafCount(input(3));expect(updateDefaults).toHaveBeenLastCalledWith('door',{leafWidths:[40,40,40]});
 tool.set('pillar');app.setProceduralNumber('depth',input(80));expect(updateDefaults).toHaveBeenLastCalledWith('pillar',{width:80,depth:80});
});
it('rejects nonfinite and oversized opening inputs before editor mutations',()=>{
 app.setProceduralNumber('width',input('NaN'));app.setProceduralNumber('openingAngle',input(181));app.setProceduralLeafWidth(1,input(16384));expect(updateDefaults).not.toHaveBeenCalled();
});
