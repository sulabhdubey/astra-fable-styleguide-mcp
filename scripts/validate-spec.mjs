import {loadCanonical} from './load-spec.mjs';import {evaluateSpec} from '../dist/packages/evaluator/src/index.js';
const result=evaluateSpec(await loadCanonical());console.log(JSON.stringify(result,null,2));if(!result.valid)process.exit(1);
