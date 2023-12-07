import {toNano} from 'ton-core';
import {UnstakeRequest} from '../wrappers/UnstakeRequest';
import {compile, NetworkProvider} from '@ton-community/blueprint';

export async function run(provider: NetworkProvider) {
    const unstakeRequest = provider.open(UnstakeRequest.createFromConfig({
        financialAddress: "",
        index: 0
    }, await compile('UnstakeRequest')));

    await unstakeRequest.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(unstakeRequest.address);

    // run methods on `unstakeRequest`
}
