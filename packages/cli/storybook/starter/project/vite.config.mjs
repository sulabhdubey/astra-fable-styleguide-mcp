import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const versions=Object.fromEntries([['react','react'],['reactDom','react-dom'],['storybook','storybook'],['vite','vite']].map(([key,name])=>[key,require(name+'/package.json').version]));
export default {define:{__STYLECON_VERSIONS__:JSON.stringify(versions)},build:{sourcemap:false},server:{host:'127.0.0.1'},preview:{host:'127.0.0.1'}};
