import {Address, toNano} from '@ton/core';
import {AdminMultisig} from '../wrappers/AdminMultisig';
import {compile, NetworkProvider} from "@ton/blueprint";

export async function run(provider: NetworkProvider) {
    let publicKeys = [
        Buffer.from("ced6d649470681b29e2cb134882a2e5dce1eb7833ee401d31386fe5717c8b6ff", "hex"),
        Buffer.from("345262316b1fc9278ece7f350d5c8d1d2b9df8ff4a4e6f5bd5d6170fe820b0ad", "hex"),
        Buffer.from("8341d77de621a6accdc999a47be6260d5354216a2f0ac67275df4a901dabbb90", "hex"),
        Buffer.from("b3a46f098b3da77e5311e169cc6582461e419c1e2b662ed11e877e7a2d0bc353", "hex"),
        Buffer.from("89eb12ee30c863a6dacc5a23f44130b9eb183c98aeeabfc30944acb100863557", "hex"),
    ]
    let addresses_str = [
        "EQCc7g6_SA0-cH6KPuaNP5cauYwQsIb0HQzQLV8IFzJKzj8v",
        "EQCarE_XXlIqD0jPW9P38DxNZOvYSa1H_lKiKfYFzvgHNsr4",
        "EQA-RbPFTIMcezw_jhmEifu_XZ8FqSFaIjKrnSxNMfQ_G18Q",
        "EQAwwjLvFaO107YZG3Rv1p26lOZhKt9WMfpbfDqsT622P877",
        "EQAV5StZqEEq1Kjyk6U4qpgGY8eyx4VeD8WqhcoDSZB0tLIK"
    ]
    let addresses = []
    const n = 5;
    for (let i = 0; i < n; i++) {
        addresses.push(Address.parse(addresses_str[i]))
    }

    const adminMultisig = provider.open(AdminMultisig.createFromConfig({
        financialAddress: "EQDNhy-nxYFgUqzfUzImBEP67JqsyMIcyk2S5_RwNNEYku0k",
        k: n - 2,
        publicKeys,
        addresses,
        walletId: 0
    }, await compile('AdminMultisig')));

    console.log('---------------------------------');
    console.log('ADMIN MULTISIG ADDRESS:', adminMultisig.address.toString())
    console.log('---------------------------------');

    await adminMultisig.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(adminMultisig.address);
}
