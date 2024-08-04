import {toNano} from '@ton/core';
import {UnstakeRequest} from '../wrappers/UnstakeRequest';
import {compile, NetworkProvider} from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const unstakeRequest = provider.open(UnstakeRequest.createFromConfig({
        financialAddress: "EQDNhy-nxYFgUqzfUzImBEP67JqsyMIcyk2S5_RwNNEYku0k",
        index: 0
    }, await compile('UnstakeRequest')));

    console.log('---------------------------------');
    console.log('UNSTAKE REQUEST ADDRESS:', unstakeRequest.address.toString())
    console.log('---------------------------------');

    await unstakeRequest.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(unstakeRequest.address);
}
