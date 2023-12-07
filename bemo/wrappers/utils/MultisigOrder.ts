import { sign, signVerify } from 'ton-crypto';
import { beginCell, Cell } from 'ton-core';

export function getOrderByPayload(payload: Cell, walletId: number = 0, queryOffset: number = 7200){
    const time = BigInt(Math.floor(Date.now() / 1000 + queryOffset));
    const queryId = time << 32n;

    return MultisigOrder.fromPayload(
        beginCell()
            .storeUint(walletId, 32)
            .storeUint(queryId, 64)
            .storeRef(payload)
            .endCell()
    );
}

export function getOrderByPayloads(payloads: Cell[], walletId: number = 0, queryOffset: number = 7200){
    const time = BigInt(Math.floor(Date.now() / 1000 + queryOffset));
    const queryId = time << 32n;

    if (payloads.length == 0){
        throw new Error("there must be at least one payload")
    }

    if (payloads.length > 3){
        throw new Error("must have 3 or less payloads")
    }

    let orderCell = beginCell()
        .storeUint(walletId, 32)
        .storeUint(queryId, 64)

    payloads.forEach((payload) => {
        orderCell.storeRef(payload)
    })

    return MultisigOrder.fromPayload(orderCell.endCell());
}

export class MultisigOrder {
    public readonly payload: Cell;
    public signatures: { [key: number]: Buffer } = {};

    private constructor(payload: Cell) {
        this.payload = payload;
    }

    public static fromCell(cell: Cell): MultisigOrder {
        let s = cell.beginParse();
        let signatures = s.loadMaybeRef()?.beginParse();
        const messagesCell = s.asCell();

        let order = new MultisigOrder(messagesCell);

        if (signatures) {
            while (signatures.remainingBits > 0) {
                const signature = signatures.loadBuffer(64);
                const ownerId = signatures.loadUint(8);
                order.signatures[ownerId] = signature;
                if (signatures.remainingRefs > 0) {
                    signatures = signatures.loadRef().asSlice();
                } else {
                    signatures.skip(1);
                }
            }
            signatures.endParse();
        }

        return order;
    }

    public static fromPayload(payload: Cell): MultisigOrder {
        return new MultisigOrder(payload);
    }

    public addSignature(
        ownerId: number,
        signature: Buffer,
        publicKey: Buffer
    ) {
        const signingHash = this.payload.hash();
        if (
            !signVerify(
                signingHash,
                signature,
                publicKey
            )
        ) {
            throw Error('invalid signature');
        }
        this.signatures[ownerId] = signature;
    }

    public sign(ownerId: number, secretKey: Buffer) {
        const signingHash = this.payload.hash();
        this.signatures[ownerId] = sign(signingHash, secretKey);
        return signingHash;
    }

    public unionSignatures(other: MultisigOrder) {
        this.signatures = Object.assign({}, this.signatures, other.signatures);
    }

    public clearSignatures() {
        this.signatures = {};
    }

    public toCell(ownerId: number): Cell {
        let b = beginCell().storeBit(0);
        for (const ownerId in this.signatures) {
            const signature = this.signatures[ownerId];
            b = beginCell()
                .storeBit(1)
                .storeRef(
                    beginCell()
                        .storeBuffer(signature)
                        .storeUint(parseInt(ownerId), 8)
                        .storeBuilder(b)
                        .endCell()
                );
        }

        return beginCell()
            .storeUint(ownerId, 8)
            .storeBuilder(b)
            .storeBuilder(this.payload.asBuilder())
            .endCell();
    }

    public toWrongCell(lockOwnerId: number): Cell {
        let b = beginCell().storeBit(0);
        const signature = this.signatures[lockOwnerId];
        for (const ownerId in this.signatures) {
            b = beginCell()
                .storeBit(1)
                .storeRef(
                    beginCell()
                        .storeBuffer(signature)
                        .storeUint(lockOwnerId, 8)
                        .storeBuilder(b)
                        .endCell()
                );
        }

        return beginCell()
            .storeUint(lockOwnerId, 8)
            .storeBuilder(b)
            .storeBuilder(this.payload.asBuilder())
            .endCell();
    }
}
