import { newLayer, type Layer, type StudioDocument } from './document';
import { mapCurves, type CurvePath } from './curves';
import { construction, DEFAULT_SHAPE, ellipsePath } from './shapes';

// Native cubic coordinates transcribed from the repository's Ximplicity mark.
const BRAND_CURVES: CurvePath[] = [{"nodes":[{"point":{"x":49.6735,"y":52.9898},"incoming":{"x":54.6258,"y":52.9898},"outgoing":{"x":44.8299,"y":52.9898},"smooth":false},{"point":{"x":37.0204,"y":50.1326},"incoming":{"x":40.6122,"y":52.0374},"outgoing":{"x":33.483,"y":48.2279},"smooth":false},{"point":{"x":28.8571,"y":41.8877},"incoming":{"x":30.7619,"y":45.4796},"outgoing":{"x":26.9524,"y":38.2959},"smooth":false},{"point":{"x":26.0,"y":29.0714},"incoming":{"x":26.0,"y":34.0238},"outgoing":{"x":26.0,"y":29.0714},"smooth":false},{"point":{"x":26.0,"y":24.2653},"incoming":{"x":26.0,"y":24.2653},"outgoing":{"x":26.0,"y":23.2313},"smooth":false},{"point":{"x":26.8163,"y":21.898},"incoming":{"x":26.2721,"y":22.4422},"outgoing":{"x":27.3605,"y":21.2993},"smooth":false},{"point":{"x":29.0204,"y":21.0},"incoming":{"x":28.0952,"y":21.0},"outgoing":{"x":30.0,"y":21.0},"smooth":false},{"point":{"x":31.3061,"y":21.898},"incoming":{"x":30.7619,"y":21.2993},"outgoing":{"x":31.8503,"y":22.4422},"smooth":false},{"point":{"x":32.1224,"y":24.2653},"incoming":{"x":32.1224,"y":23.2313},"outgoing":{"x":32.1224,"y":24.2653},"smooth":false},{"point":{"x":32.1224,"y":29.3163},"incoming":{"x":32.1224,"y":29.3163},"outgoing":{"x":32.1224,"y":35.1939},"smooth":false},{"point":{"x":36.7755,"y":42.949},"incoming":{"x":33.6735,"y":39.7381},"outgoing":{"x":39.8775,"y":46.1599},"smooth":false},{"point":{"x":49.8367,"y":47.7653},"incoming":{"x":44.2313,"y":47.7653},"outgoing":{"x":55.4966,"y":47.7653},"smooth":false},{"point":{"x":63.0612,"y":42.949},"incoming":{"x":59.9047,"y":46.1599},"outgoing":{"x":66.2721,"y":39.6837},"smooth":false},{"point":{"x":67.8775,"y":29.3163},"incoming":{"x":67.8775,"y":35.1395},"outgoing":{"x":67.8775,"y":29.3163},"smooth":false},{"point":{"x":67.8775,"y":24.2653},"incoming":{"x":67.8775,"y":24.2653},"outgoing":{"x":67.8775,"y":23.2313},"smooth":false},{"point":{"x":68.6939,"y":21.898},"incoming":{"x":68.1496,"y":22.4422},"outgoing":{"x":69.2925,"y":21.2993},"smooth":false},{"point":{"x":70.9796,"y":21.0},"incoming":{"x":70.0544,"y":21.0},"outgoing":{"x":71.9592,"y":21.0},"smooth":false},{"point":{"x":73.1836,"y":21.898},"incoming":{"x":72.6939,"y":21.2993},"outgoing":{"x":73.7279,"y":22.4422},"smooth":false},{"point":{"x":74.0,"y":24.2653},"incoming":{"x":74.0,"y":24.2653},"outgoing":{"x":74.0,"y":24.2653},"smooth":false},{"point":{"x":74.0,"y":29.0714},"incoming":{"x":74.0,"y":29.0714},"outgoing":{"x":74.0,"y":33.8605},"smooth":false},{"point":{"x":71.0612,"y":41.7245},"incoming":{"x":73.0204,"y":38.0782},"outgoing":{"x":69.102,"y":45.3163},"smooth":false},{"point":{"x":62.5714,"y":50.051},"incoming":{"x":66.2721,"y":48.0918},"outgoing":{"x":58.9252,"y":52.0102},"smooth":false}],"closed":true},{"nodes":[{"point":{"x":50.3265,"y":47.7857},"incoming":{"x":45.3742,"y":47.7857},"outgoing":{"x":55.1701,"y":47.7857},"smooth":false},{"point":{"x":62.9796,"y":50.6429},"incoming":{"x":59.3878,"y":48.7381},"outgoing":{"x":66.517,"y":52.5476},"smooth":false},{"point":{"x":71.1429,"y":58.8878},"incoming":{"x":69.2381,"y":55.2959},"outgoing":{"x":73.0476,"y":62.4796},"smooth":false},{"point":{"x":74.0,"y":71.7041},"incoming":{"x":74.0,"y":66.7517},"outgoing":{"x":74.0,"y":71.7041},"smooth":false},{"point":{"x":74.0,"y":76.5102},"incoming":{"x":74.0,"y":76.5102},"outgoing":{"x":74.0,"y":77.5442},"smooth":false},{"point":{"x":73.1837,"y":78.8776},"incoming":{"x":73.7279,"y":78.3333},"outgoing":{"x":72.6395,"y":79.4762},"smooth":false},{"point":{"x":70.9796,"y":79.7755},"incoming":{"x":71.9048,"y":79.7755},"outgoing":{"x":70.0,"y":79.7755},"smooth":false},{"point":{"x":68.6939,"y":78.8776},"incoming":{"x":69.2381,"y":79.4762},"outgoing":{"x":68.1497,"y":78.3333},"smooth":false},{"point":{"x":67.8776,"y":76.5102},"incoming":{"x":67.8776,"y":77.5442},"outgoing":{"x":67.8776,"y":76.5102},"smooth":false},{"point":{"x":67.8776,"y":71.4592},"incoming":{"x":67.8776,"y":71.4592},"outgoing":{"x":67.8776,"y":65.5816},"smooth":false},{"point":{"x":63.2245,"y":57.8265},"incoming":{"x":66.3265,"y":61.0374},"outgoing":{"x":60.1225,"y":54.6157},"smooth":false},{"point":{"x":50.1633,"y":53.0102},"incoming":{"x":55.7687,"y":53.0102},"outgoing":{"x":44.5034,"y":53.0102},"smooth":false},{"point":{"x":36.9388,"y":57.8265},"incoming":{"x":40.0953,"y":54.6157},"outgoing":{"x":33.7279,"y":61.0918},"smooth":false},{"point":{"x":32.1225,"y":71.4592},"incoming":{"x":32.1225,"y":65.6361},"outgoing":{"x":32.1225,"y":71.4592},"smooth":false},{"point":{"x":32.1225,"y":76.5102},"incoming":{"x":32.1225,"y":76.5102},"outgoing":{"x":32.1225,"y":77.5442},"smooth":false},{"point":{"x":31.3061,"y":78.8776},"incoming":{"x":31.8504,"y":78.3333},"outgoing":{"x":30.7075,"y":79.4762},"smooth":false},{"point":{"x":29.0204,"y":79.7755},"incoming":{"x":29.9456,"y":79.7755},"outgoing":{"x":28.0408,"y":79.7755},"smooth":false},{"point":{"x":26.8164,"y":78.8776},"incoming":{"x":27.3061,"y":79.4762},"outgoing":{"x":26.2721,"y":78.3333},"smooth":false},{"point":{"x":26.0,"y":76.5102},"incoming":{"x":26.0,"y":76.5102},"outgoing":{"x":26.0,"y":76.5102},"smooth":false},{"point":{"x":26.0,"y":71.7041},"incoming":{"x":26.0,"y":71.7041},"outgoing":{"x":26.0,"y":66.915},"smooth":false},{"point":{"x":28.9388,"y":59.051},"incoming":{"x":26.9796,"y":62.6973},"outgoing":{"x":30.898,"y":55.4592},"smooth":false},{"point":{"x":37.4286,"y":50.7245},"incoming":{"x":33.7279,"y":52.6837},"outgoing":{"x":41.0749,"y":48.7653},"smooth":false}],"closed":true}];

const COLORS = { navy:'#101824', panel:'#182334', blue:'#0066ff', mint:'#9de8d3', ivory:'#f4f1e9', muted:'#9aaac0', line:'#304258' };

/** A fully editable cover; no external assets or embedded raster data are required. */
export function createSampleDocument(): StudioDocument {
  const layers:Layer[]=[];
  const add=(id:string,kind:Layer['kind'],x:number,y:number,width:number,height:number,fill:string,group:string,extra:Partial<Layer>={})=>{
    const layer={...newLayer(kind,id,{x,y},fill,fill,0),name:id.replaceAll('-',' '),width,height,groupPath:[group],...extra};
    layers.push(layer);return layer;
  };
  const label=(id:string,text:string,x:number,y:number,size:number,width:number,fill=COLORS.ivory,group='Editorial')=>add(id,'text',x,y,width,size*1.3,fill,group,{text,fontSize:size});
  const curve=(id:string,x:number,y:number,width:number,height:number,paths:CurvePath[],fill:string,group:string,stroke=fill,strokeWidth=0)=>add(id,'path',x,y,width,height,fill,group,{curves:paths,stroke,strokeWidth});
  const line=(id:string,x:number,y:number,width:number,stroke=COLORS.line)=>add(id,'path',x,y,width,1,stroke,'Editorial',{points:[{x:0,y:0},{x:width,y:0}],stroke,strokeWidth:1});

  label('Brand-wordmark','X I M P L I C I T Y',64,47,17,330,COLORS.mint);
  label('Edition-label','DRAWING EXPLORATIONS  /  01',1040,49,12,340,COLORS.muted);
  line('Header-rule',64,96,1312);
  label('Cover-eyebrow','YOUR NEXT IDEA STARTS HERE',64,151,15,710,COLORS.mint);
  label('Cover-title','Ximply',59,190,98,780);
  label('Cover-subtitle','Design Studio',64,307,64,820);
  label('Cover-description','Shape a thought. Give it a curve.',67,403,24,830,COLORS.muted);
  label('Editable-caption','Editable vectors, from the first point to the final composition.',67,451,16,810,COLORS.muted);

  // The ring and both halves are separate editable paths, grouped as a single mark.
  curve('Brand-emblem-ring',1030,167,292,292,[ellipsePath(146,146,144,144)],COLORS.navy,'Ximplicity mark',COLORS.ivory,2);
  curve('Brand-X-upper',1026,163,300,300,mapCurves([BRAND_CURVES[0]],p=>({x:p.x*3,y:p.y*3})),COLORS.blue,'Ximplicity mark');
  curve('Brand-X-lower',1026,163,300,300,mapCurves([BRAND_CURVES[1]],p=>({x:p.x*3,y:p.y*3})),COLORS.blue,'Ximplicity mark');
  add('Orbit-dot','ellipse',1310,271,13,13,COLORS.mint,'Ximplicity mark');

  const cards=[{x:64,title:'01  /  CURVES',name:'Curve study'},{x:512,title:'02  /  GEOMETRY',name:'Geometry study'},{x:960,title:'03  /  RHYTHM',name:'Rhythm study'}];
  for(const card of cards){
    curve(card.name+'-panel',card.x,562,416,270,construction('rounded',{x:0,y:0},{x:416,y:270},{...DEFAULT_SHAPE,radius:16}),COLORS.panel,card.name);
    label(card.name+'-label',card.title,card.x+24,584,12,360,COLORS.muted,card.name);
  }
  const ribbon:CurvePath={closed:false,nodes:[
    {point:{x:0,y:126},incoming:{x:0,y:126},outgoing:{x:65,y:126},smooth:false},
    {point:{x:114,y:24},incoming:{x:48,y:24},outgoing:{x:180,y:24},smooth:true},
    {point:{x:228,y:126},incoming:{x:162,y:126},outgoing:{x:294,y:126},smooth:true},
    {point:{x:322,y:28},incoming:{x:282,y:28},outgoing:{x:322,y:28},smooth:false}
  ]};
  curve('Cobalt-cubic-ribbon',110,625,322,150,[ribbon],COLORS.blue,'Curve study',COLORS.blue,22);
  curve('Mint-cubic-echo',110,653,322,150,[ribbon],COLORS.mint,'Curve study',COLORS.mint,3);
  add('Curve-start-point','ellipse',104,745,12,12,COLORS.ivory,'Curve study');
  add('Curve-end-point','ellipse',426,647,12,12,COLORS.ivory,'Curve study');

  curve('Six-sided-polygon',552,651,128,130,construction('polygon',{x:0,y:0},{x:128,y:130},{...DEFAULT_SHAPE,sides:6}),COLORS.blue,'Geometry study');
  curve('Eight-point-star',670,640,146,146,construction('star',{x:0,y:0},{x:146,y:146},{...DEFAULT_SHAPE,sides:8,inner:.64}),COLORS.mint,'Geometry study');
  curve('Circular-outline',798,679,90,90,[ellipsePath(45,45,43,43)],COLORS.panel,'Geometry study',COLORS.ivory,2);
  add('Geometry-center','ellipse',825,706,36,36,COLORS.blue,'Geometry study');

  for(let index=0;index<7;index++){
    const diameter=148-index*17;
    curve('Concentric-orbit-'+(index+1),1004+index*8.5,637+index*8.5,diameter,diameter,[ellipsePath(diameter/2,diameter/2,diameter/2,diameter/2)],COLORS.panel,'Rhythm study',index%2?COLORS.mint:COLORS.blue,2);
  }
  for(let index=0;index<5;index++){
    const height=48+index*24;
    curve('Rhythm-column-'+(index+1),1192+index*27,794-height,13,height,construction('rounded',{x:0,y:0},{x:13,y:height},{...DEFAULT_SHAPE,radius:6}),index===4?COLORS.ivory:COLORS.mint,'Rhythm study');
  }
  line('Footer-rule',64,872,1312);
  label('Footer-caption','MAKE IT SIMPLE. MAKE IT YOURS.',64,898,13,760,COLORS.muted);
  [COLORS.blue,COLORS.mint,COLORS.ivory].forEach((fill,index)=>add('Palette-swatch-'+(index+1),'ellipse',1264+index*36,896,20,20,fill,'Palette'));
  return {format:'ximply-document',version:2,name:'Ximply Design Studio — First impressions',width:1440,height:960,background:COLORS.navy,layers};
}
