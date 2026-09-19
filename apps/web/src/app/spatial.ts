import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { StudioDocument } from '../../../../packages/domain/src/document';
import { CanvasRenderer } from '../../../../packages/renderer/src/canvas-renderer';
export async function createSpatialPreview(host:HTMLElement,document:StudioDocument,canvasRenderer:CanvasRenderer):Promise<()=>void>{
 const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(host.clientWidth,host.clientHeight);renderer.setClearColor('#121720');host.appendChild(renderer.domElement);
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(40,host.clientWidth/host.clientHeight,.1,100);camera.position.set(3,2,5);const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;
 const geometries:THREE.BufferGeometry[]=[],materials:THREE.Material[]=[],textures:THREE.Texture[]=[];
 const width=document.width/400,height=document.height/400;
 const background=new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshBasicMaterial({color:document.background,side:THREE.DoubleSide}));scene.add(background);geometries.push(background.geometry);materials.push(background.material);
 let index=0;for(const layer of document.layers.filter(l=>l.visible)){
   const single={...document,background:'#ffffff',layers:[{...layer,blend:'source-over' as const}]};const canvas=await canvasRenderer.export(single,true);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;textures.push(texture);
   const geometry=new THREE.PlaneGeometry(width,height),material=new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide,transparent:true,opacity:1});const plane=new THREE.Mesh(geometry,material);plane.position.z=(++index)*.15;scene.add(plane);geometries.push(geometry);materials.push(material);
   const edges=new THREE.EdgesGeometry(geometry),lineMaterial=new THREE.LineBasicMaterial({color:'#3979ff'});const outline=new THREE.LineSegments(edges,lineMaterial);outline.position.copy(plane.position);scene.add(outline);geometries.push(edges);materials.push(lineMaterial);
 }
 const axes=new THREE.AxesHelper(1);axes.position.set(-width/2-.3,-height/2-.3,0);scene.add(axes);
 const resize=new ResizeObserver(()=>{renderer.setSize(host.clientWidth,host.clientHeight);camera.aspect=host.clientWidth/host.clientHeight;camera.updateProjectionMatrix();});resize.observe(host);
 renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});return()=>{resize.disconnect();renderer.setAnimationLoop(null);controls.dispose();for(const x of geometries)x.dispose();for(const x of materials)x.dispose();for(const x of textures)x.dispose();axes.dispose();renderer.dispose();renderer.domElement.remove();};
}
