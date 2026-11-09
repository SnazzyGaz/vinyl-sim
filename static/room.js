/* A quiet Early Art Deco study. Millimetres, Z-up; no downloaded textures.
   Floor and panelling use instancing so the room remains inexpensive to draw. */
export function buildParlor(THREE){
 const room=new THREE.Group();room.name='deco-parlor';
 const plaster=new THREE.MeshStandardMaterial({color:0x777767,roughness:.96});
 const oak=new THREE.MeshPhysicalMaterial({color:0x795333,roughness:.68,specularIntensity:.3});
 const walnut=new THREE.MeshStandardMaterial({color:0x30251e,roughness:.44});
 const ivory=new THREE.MeshStandardMaterial({color:0xc8bda1,roughness:.8});
 const brass=new THREE.MeshStandardMaterial({color:0xba985b,metalness:.85,roughness:.36});
 const add=(g,m,x,y,z,name)=>{const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.name=name||'';o.receiveShadow=true;o.castShadow=true;room.add(o);return o;};
 const box=(w,d,h,m,x,y,z,name)=>add(new THREE.BoxGeometry(w,d,h),m,x,y,z,name);
 // Continuous dark joints below individual oak boards.
 box(2400,2400,6,walnut,0,0,-6,'floor');
 const boardGeo=new THREE.BoxGeometry(298,58,3),matrix=new THREE.Matrix4();
 const grain=oak.clone();
 grain.onBeforeCompile=shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vWood;').replace('#include <begin_vertex>','#include <begin_vertex>\nvWood=position;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vWood;').replace('#include <color_fragment>','#include <color_fragment>\nfloat grain=.5+.5*sin(vWood.y*1.15+sin(vWood.x*.025)*1.8);diffuseColor.rgb*=.85+.15*grain;');
 };
 const boards=new THREE.InstancedMesh(boardGeo,grain,40*9);let i=0;
 for(let row=0;row<40;row++)for(let col=0;col<9;col++){
  matrix.makeTranslation(-1200+col*300+(row%2)*150,-1170+row*60,-1.5);boards.setMatrixAt(i,matrix);
  boards.setColorAt(i++,new THREE.Color().setHSL(.075+(row%3)*.004,.29,.23+((row*13+col*7)%9)*.012));
 }
 boards.receiveShadow=true;boards.name='oak-floorboards';room.add(boards);
 // The rear window is a real gap between pieces of wall, not a bright decal.
 const back=540,H=880,wx=-360,ww=290,bottom=205,top=695;
 box(695,18,H,plaster,-852.5,back,H/2);
 box(1415,18,H,plaster,492.5,back,H/2);
 box(ww,18,bottom,plaster,wx,back,bottom/2);
 box(ww,18,H-top,plaster,wx,back,(H+top)/2);
 box(18,1740,H,plaster,-1200,-330,H/2,'left-wall');
 box(18,1740,H,plaster,1200,-330,H/2,'right-wall');
 box(2400,18,H,plaster,0,-1200,H/2,'front-wall');
 box(2400,1740,12,ivory,0,-330,H,'ceiling');
 // Low walnut wainscot, repeated field panels and narrow brass chair rail.
 box(2400,14,145,walnut,0,525,72.5);box(2400,16,16,walnut,0,515,8);
 box(2400,20,8,oak,0,514,145);box(2400,4,2,brass,0,502,151);
 const panels=new THREE.InstancedMesh(new THREE.BoxGeometry(132,5,99),oak,15);
 for(let n=0;n<15;n++){matrix.makeTranslation(-1120+n*160,514,73);panels.setMatrixAt(n,matrix);}panels.receiveShadow=true;room.add(panels);
 for(const x of [-1186,1186]){box(14,1740,145,walnut,x,-330,72.5);box(20,1740,8,oak,x,-330,145);box(24,1740,16,walnut,x,-330,8);}
 // Pale daylight glass, dark slender mullions, stepped ivory reveal.
 const glass=new THREE.MeshStandardMaterial({color:0xa4bac5,emissive:0x91a7b4,emissiveIntensity:.65,roughness:.32});
 box(ww,4,top-bottom,glass,wx,552,(top+bottom)/2,'daylight-window');
 for(const x of [wx-ww/2,wx+ww/2]){box(20,34,top-bottom+36,ivory,x,524,(top+bottom)/2);box(5,38,top-bottom+18,walnut,x,502,(top+bottom)/2);}
 for(const z of [bottom,top])box(ww+36,36,20,ivory,wx,524,z);
 box(ww+58,60,13,oak,wx,506,bottom-13);
 box(9,10,top-bottom,walnut,wx,535,(top+bottom)/2);
 for(const z of [bottom+150,bottom+330])box(ww,10,8,walnut,wx,535,z);
 // Quiet rug behind the cabinet: it never floats under the sleeve rack.
 const rug=new THREE.MeshStandardMaterial({color:0x38443d,roughness:1});
 box(790,355,1.4,rug,120,285,.7,'study-rug');
 for(const x of [-263,503])box(3,326,.3,ivory,x,285,1.55);
 for(const y of [128,442])box(766,3,.3,ivory,120,y,1.55);
 // A shallow writing console stays against the rear wall, outside the orbit.
 box(370,114,17,walnut,420,433,246,'writing-console');
 for(const x of [262,578])for(const y of [394,472])box(13,13,237,walnut,x,y,119);
 box(330,12,55,oak,420,384,210);box(38,3,3,brass,420,376,211);
 // An ivory opaline lamp is the warm counterpart to the daylight window.
 add(new THREE.CylinderGeometry(28,32,7,40),brass,530,435,258).rotation.x=Math.PI/2;
 box(5,5,88,brass,530,435,301);
 const shade=new THREE.MeshStandardMaterial({color:0xe4d5af,emissive:0xd4a365,emissiveIntensity:.25,roughness:.86});
 add(new THREE.CylinderGeometry(25,41,53,8),shade,530,435,354,'opaline-lamp').rotation.x=Math.PI/2;
 // Warm fill is non-shadowed; only the window key pays for a shadow map.
 const warm=new THREE.PointLight(0xffd7a1,30000,1150,2);warm.position.set(520,405,340);room.add(warm);
 return room;
}
