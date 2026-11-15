import { pipeline, env } from '@huggingface/transformers';
env.cacheDir = 'E:\\ALP-data\\models\\transformers';
env.remoteHost = 'https://hf-mirror.com';
console.log('host =', env.remoteHost);
const t0 = Date.now();
try {
  const ex = await pipeline('feature-extraction', 'Xenova/bge-small-zh-v1.5', { dtype: 'fp32' });
  console.log('MODEL OK in', ((Date.now()-t0)/1000).toFixed(1), 's');
  const out = await ex(['白切鸡要三提三浸，冰水过冷', '宫保鸡丁的荔枝味来自糖醋比'], { pooling: 'mean', normalize: true });
  console.log('dims =', out.dims);
  const a = out.tolist();
  console.log('vec[:4] =', a[0].slice(0,4).map(x=>x.toFixed(4)).join(','));
  console.log('sim =', a[0].reduce((s,v,i)=>s+v*a[1][i],0).toFixed(4));
} catch (e) {
  console.log('FAIL', (e.message||'').slice(0,300));
}
