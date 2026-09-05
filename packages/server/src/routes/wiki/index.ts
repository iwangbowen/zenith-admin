import {
  wikiCommentContract, wikiDocContract, wikiGovernanceContract,
  wikiSpaceContract, wikiStatsContract, wikiTagContract, wikiTemplateContract,
} from '@zenith/shared/wiki';
import { defineRouteDomain } from '../_kit';
import wikiSpacesRoutes from './wiki-spaces';
import wikiDocsRoutes from './wiki-docs';
import wikiTemplatesRoutes from './wiki-templates';
import wikiTagsRoutes from './wiki-tags';
import wikiCommentsRoutes from './wiki-comments';
import wikiGovernanceRoutes from './wiki-governance';
import wikiStatsRoutes from './wiki-stats';

export default defineRouteDomain({
  name: 'wiki',
  mounts: () => [
    [wikiSpaceContract.basePath, wikiSpacesRoutes, { feature: 'wiki' }],
    [wikiDocContract.basePath, wikiDocsRoutes, { feature: 'wiki' }],
    [wikiTemplateContract.basePath, wikiTemplatesRoutes, { feature: 'wiki' }],
    [wikiTagContract.basePath, wikiTagsRoutes, { feature: 'wiki' }],
    [wikiCommentContract.basePath, wikiCommentsRoutes, { feature: 'wiki' }],
    [wikiStatsContract.basePath, wikiStatsRoutes, { feature: 'wiki' }],
    [wikiGovernanceContract.basePath, wikiGovernanceRoutes, { feature: 'wiki' }],
  ],
});
