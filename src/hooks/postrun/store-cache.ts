import { Hook } from '@oclif/core';
import { copyLocalSfdxInfo } from '../../common/utils/index.js';

const hook: Hook<'postrun'> = async (options) => {
  // Skip hooks from other commands than hardis commands
  const commandId = options?.Command?.id || '';
  if (!commandId.startsWith('hardis:scratch:create')) {
    return;
  }

  // Copy local SFDX cache for CI
  await copyLocalSfdxInfo();
  return;
};

export default hook;
