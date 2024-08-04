import {Address, toNano} from '@ton/core'
import {NetworkProvider} from '@ton/blueprint'
import {JettonWallet} from "../wrappers/JettonWallet";

export async function run(provider: NetworkProvider) {
    const jettonWallet = provider.open(JettonWallet.createFromAddress(Address.parse("EQAzV2PF2-5skwCs4HmXk8aUxihnPRIIhvoc0Gdc8oSOfqSW")));
    await jettonWallet.sendBurn(provider.sender(), toNano('0.06'), {jettonAmount: 0.1});
}
