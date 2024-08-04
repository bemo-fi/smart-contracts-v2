import { CompilerConfig } from '@ton/blueprint';

export const compile: CompilerConfig = {
    targets: ['contracts/imports/stdlib.fc', 'contracts/nominator_pool.fc'],
};
