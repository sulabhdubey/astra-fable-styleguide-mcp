/* global __STYLECON_VERSIONS__ */
import {composeStories,setProjectAnnotations} from '@storybook/react';
import * as stories from './Components.stories.mjs';
import {mountStoryHarness} from '../../../packages/cli/storybook/harness.mjs';
const annotations=setProjectAnnotations({parameters:{layout:'padded'}});
await mountStoryHarness({stories:composeStories(stories),beforeAll:annotations.beforeAll,versions:__STYLECON_VERSIONS__});
