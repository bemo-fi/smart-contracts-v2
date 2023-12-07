import {Address, toNano} from 'ton-core'
import {NetworkProvider} from '@ton-community/blueprint'
import {JettonWallet} from "../wrappers/JettonWallet";

export async function run(provider: NetworkProvider) {
    const financial = provider.open(JettonWallet.createFromAddress(Address.parse("EQDgAgsb8v6RGjHhQFvdbBCXbdYwoA69uXuT_MduDBlzVf7-")));
    await financial.sendBurn(provider.sender(), toNano('1'), {jettonAmount: 31.9});
}
