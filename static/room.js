/* An Early Art Deco study, photographed. Millimetres, Z-up, floor at z=0.
   All surfaces come from the shared procedural look (materials.js); nothing is
   downloaded. Large flat pieces are single meshes so the room stays cheap. */
export function buildParlor(THREE,look){
 const room=new THREE.Group();room.name='deco-parlor';
 const L=look||null;
 const std=(color,rough=.8)=>new THREE.MeshStandardMaterial({color,roughness:rough});
 const plaster=L?L.plaster(0xf2eee4):std(0x8a8672,.95);
 const walnut=L?L.lacquer(0x9a8a80,{rough:.5,coat:.6,grainMM:260,lite:true}):std(0x30251e,.44);
 const oak=L?L.lacquer(0xffffff,{kind:'oak',rough:.55,coat:.4,grainMM:320,lite:true}):std(0x795333,.68);
 const ivory=L?L.ivory():std(0xc8bda1,.8);
 const brass=L?L.brass({rough:.55}):new THREE.MeshStandardMaterial({color:0xba985b,metalness:.85,roughness:.36});
 const add=(g,m,x,y,z,name,shadow=true)=>{const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.name=name||'';o.receiveShadow=true;o.castShadow=shadow;room.add(o);return o;};
 const box=(w,d,h,m,x,y,z,name,shadow)=>add(new THREE.BoxGeometry(w,d,h),m,x,y,z,name,shadow);

 // Floor: one textured plane of staggered oak boards (1200 mm texture tile).
 const floorGeo=new THREE.PlaneGeometry(2400,2400);const uv=floorGeo.attributes.uv;for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*2,uv.getY(i)*2);
 add(floorGeo,L?L.floor():std(0x795333,.6),0,0,0,'floor',false);
 const under=box(2400,2400,6,std(0x1a120c,1),0,0,-3.2,'subfloor',false);under.receiveShadow=false;

 // Walls; the rear window is a real gap with a garden beyond it.
 const back=540,H=880,wx=-360,ww=290,bottom=205,top=695;
 box(695,18,H,plaster,-852.5,back,H/2,'back-wall');
 box(1415,18,H,plaster,492.5,back,H/2,'back-wall');
 box(ww,18,bottom,plaster,wx,back,bottom/2);
 box(ww,18,H-top,plaster,wx,back,(H+top)/2);
 box(18,1740,H,plaster,-1200,-330,H/2,'left-wall');
 box(18,1740,H,plaster,1200,-330,H/2,'right-wall');
 box(2400,18,H,plaster,0,-1200,H/2,'front-wall');
 box(2400,1740,12,ivory,0,-330,H+6,'ceiling',false);
 room.userData.ceilingZ=H; // underside of the ceiling, room-local; the camera stays below it
 // Crown moulding where the walls meet the ceiling.
 box(2400,30,24,ivory,0,back-20,H-12,'',false);
 // Walnut wainscot with fielded oak panels and a slim brass chair rail.
 box(2400,14,145,walnut,0,525,72.5);box(2400,16,16,walnut,0,515,8);
 box(2400,20,8,oak,0,514,145);box(2400,4,2,brass,0,502,151,'chair-rail',false);
 const panelGeo=new THREE.BoxGeometry(132,5,99),panels=new THREE.InstancedMesh(panelGeo,oak,15),matrix=new THREE.Matrix4();
 for(let n=0;n<15;n++){matrix.makeTranslation(-1120+n*160,514,73);panels.setMatrixAt(n,matrix);}panels.receiveShadow=true;panels.castShadow=false;room.add(panels);
 for(const x of [-1186,1186]){box(14,1740,145,walnut,x,-330,72.5);box(20,1740,8,oak,x,-330,145);box(24,1740,16,walnut,x,-330,8);}

 // Window: out-of-focus garden, thin glass sheen, ivory reveal, walnut glazing bars.
 const garden=new THREE.Mesh(new THREE.PlaneGeometry(ww*1.9,(top-bottom)*1.7),L?L.garden():new THREE.MeshBasicMaterial({color:0xd8e4ea}));
 garden.name='daylight-window';garden.rotation.x=Math.PI/2;garden.position.set(wx,back+140,(top+bottom)/2);room.add(garden);
 const glass=new THREE.Mesh(new THREE.PlaneGeometry(ww,top-bottom),new THREE.MeshStandardMaterial({color:0xffffff,roughness:.05,metalness:0,transparent:true,opacity:.07,depthWrite:false}));
 glass.rotation.x=Math.PI/2;glass.position.set(wx,back+2,(top+bottom)/2);room.add(glass);
 for(const x of [wx-ww/2,wx+ww/2]){box(20,34,top-bottom+36,ivory,x,524,(top+bottom)/2);box(5,38,top-bottom+18,walnut,x,502,(top+bottom)/2);}
 for(const z of [bottom,top])box(ww+36,36,20,ivory,wx,524,z);
 box(ww+58,60,13,oak,wx,506,bottom-13,'sill');
 box(9,10,top-bottom,walnut,wx,535,(top+bottom)/2);
 for(const z of [bottom+150,bottom+330])box(ww,10,8,walnut,wx,535,z);
 // Heavy linen curtains, gathered either side of the window.
 const curtain=L?L.fabric(0x6b5a3e):std(0x6b5a3e,.95);
 for(const sx of [-1,1]){
  const g=new THREE.PlaneGeometry(120,H-40,24,1),p=g.attributes.position;
  for(let i=0;i<p.count;i++){const x=p.getX(i);p.setZ(i,Math.sin(x*.16)*9+Math.sin(x*.05)*4);}g.computeVertexNormals();
  const c=new THREE.Mesh(g,curtain);c.rotation.x=Math.PI/2;c.position.set(wx+sx*(ww/2+78),back-34,(H-40)/2+4);c.castShadow=true;c.receiveShadow=true;c.name='curtain';room.add(c);
 }
 box(ww+380,10,10,brass,wx,back-40,H-36,'curtain-rod',false);

 // Quiet Deco rug behind the cabinet; it never floats under the sleeve rack.
 add(new THREE.BoxGeometry(790,355,3),L?L.rug():std(0x38443d,1),120,285,1.5,'study-rug',false);

 // Writing console against the rear wall, with an opaline lamp: the warm counterpart to the window.
 box(370,114,17,walnut,420,433,246,'writing-console');
 for(const x of [262,578])for(const y of [394,472])box(13,13,237,walnut,x,y,119);
 box(330,12,55,oak,420,384,210);box(38,3,3,brass,420,376,211);
 add(new THREE.CylinderGeometry(28,32,7,48),brass,530,435,258).rotation.x=Math.PI/2;
 box(5,5,88,brass,530,435,301);
 const shade=new THREE.MeshStandardMaterial({color:0xf3e6c6,emissive:0xffc77e,emissiveIntensity:1.6,roughness:.86});
 add(new THREE.CylinderGeometry(25,41,53,24,1,true),shade,530,435,354,'opaline-lamp',false).rotation.x=Math.PI/2;
 // A framed Deco print on the back wall.
 const frame=box(230,10,300,L?L.lacquer(0x2a2a2a,{rough:.35,grainMM:200,lite:true}):walnut,700,back-14,520,'picture-frame');
 const mount=box(196,4,266,ivory,700,back-20,520,'',false);mount.castShadow=false;
 const art=new THREE.Mesh(new THREE.PlaneGeometry(150,210),new THREE.MeshStandardMaterial({color:0x2f4038,roughness:.9}));art.rotation.x=Math.PI/2;art.position.set(700,back-22.5,520);room.add(art);
 for(let k=0;k<5;k++){const ray=new THREE.Mesh(new THREE.PlaneGeometry(4,150),new THREE.MeshStandardMaterial({color:0xc9a75e,metalness:.6,roughness:.35}));ray.rotation.set(Math.PI/2,0,(k-2)*.3);ray.position.set(700,back-23,470);room.add(ray);}
 // Warm lamp light: unshadowed fill. Only the window key pays for a shadow map.
 const warm=new THREE.PointLight(0xffc98a,26000,1500,2);warm.name='lamp-light';warm.position.set(530,405,354);room.add(warm);
 return room;
}
