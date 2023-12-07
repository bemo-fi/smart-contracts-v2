import {Address, toNano} from 'ton-core'
import {NominatorProxy} from '../wrappers/NominatorProxy'
import {compile, NetworkProvider, sleep} from '@ton-community/blueprint'

export async function run(provider: NetworkProvider) {

    const proxy = provider.open(NominatorProxy.createFromConfig({
        depositAmount: 0,
        depositTime: 0,
        financialAddress: "EQAlo09uk_Q8eyfmejNobKNL-2nnQqkbFUrsDfrLXGoC71lA",
        nominatorPoolAddress: "Ef9Q3y_JQr7uIoB6uKKFXhcpCwnIq4nUP-eDdVuQYdYsUERp"
    }, await compile('NominatorProxy')));

    await proxy.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(proxy.address);

    console.log(await proxy.getProxyData())

    // await proxy.sendTonToNominatorProxy(provider.sender(), toNano("1"))
    //
    // await sleep(3000)
    //
    // console.log(await proxy.getProxyData())
    // run methods on `nominatorProxy`
}
