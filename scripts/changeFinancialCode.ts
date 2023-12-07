import {Address, toNano} from 'ton-core'
import {compile, NetworkProvider, sleep} from '@ton-community/blueprint'
import {AdminMultisig} from "../wrappers/AdminMultisig";
import {mnemonicToPrivateKey} from "ton-crypto";
import {getChangeAdminMultisigPayload, getChangeFinancialCodePayload} from "../wrappers/utils/AdminMultisigUtils";
import {getOrderByPayload} from "../wrappers/utils/MultisigOrder";
import {Financial} from "../wrappers/Financial";

export async function run(provider: NetworkProvider) {

    const admin = provider.open(AdminMultisig.createFromAddress(Address.parse("EQCYeTqSYYZ0IWc2OfmzMOJLx-J6EBaDHG6JvtoD0HKYpDoN")));

    const mnemonic = [
        'risk notable famous gather tent mammal step bullet drop elephant clog tape hollow series drip bridge leaf comic coyote among few bomb exile obvious',
        'suspect review egg loop gun hedgehog own trick cactus pet match tape club shine tunnel purse cotton relief farm chest hover loan body sign',
        'build tube shed wine ready athlete bread nature rebel stove core umbrella rough priority squirrel churn awkward talent sunny panic ensure fantasy rigid blush'
    ]

    const changeCodeMultisigPayload = getChangeFinancialCodePayload(await compile("Financial"))
    const changeCodeMultisigOrder = getOrderByPayload(changeCodeMultisigPayload)

    for (let i = 0; i < 3; i++) {
        const ownerKeys = await mnemonicToPrivateKey(mnemonic[i].split(" "))
        changeCodeMultisigOrder.sign(i, ownerKeys.secretKey)
    }

    await admin.sendOrder(changeCodeMultisigOrder, (await mnemonicToPrivateKey(mnemonic[0].split(" "))).secretKey, 0);

    await sleep(15000)

    console.log(await admin.getTempConfig())
}
