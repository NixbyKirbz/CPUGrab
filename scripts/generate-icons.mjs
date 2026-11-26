import sharp from 'sharp';
import { copyFile } from 'node:fs/promises';
for(const [name,size] of [['icon-192',192],['icon-512',512],['maskable-512',512],['apple-touch-icon',180]]){
 const logo=await sharp('public/brand/logo.png').resize({width:Math.round(size*.78),height:Math.round(size*.6),fit:'inside'}).png().toBuffer();
 await sharp({create:{width:size,height:size,channels:4,background:'#ffffff'}}).composite([{input:logo,gravity:'center'}]).png().toFile(`public/icons/${name}.png`);
}
await copyFile('public/icons/icon-192.png','src/app/icon.png');
