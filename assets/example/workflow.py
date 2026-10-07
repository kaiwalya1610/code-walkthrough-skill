"""Small executable fixture for the walkthrough format, not application scaffolding."""


def prepare_orders(orders, emit):
    pending = [order["id"] for order in orders]
    accepted, rejected = [], []
    total = 0
    emit("start", pending=pending, accepted=accepted, rejected=rejected, total=total)
    for index, order in enumerate(orders, 1):
        pending.pop(0)
        valid = order["quantity"] > 0
        emit(f"check-{index}", pending=pending, accepted=accepted, rejected=rejected,
             total=total, valid=valid, current=order)
        if valid:
            subtotal = order["quantity"] * order["unit_price"]
            accepted.append({**order, "subtotal": subtotal})
            total += subtotal
        else:
            rejected.append({"id": order["id"], "reason": "Quantity must be positive"})
        emit(f"item-{index}", pending=pending, accepted=accepted, rejected=rejected,
             total=total, valid=valid, current=order)
    emit("done", pending=pending, accepted=accepted, rejected=rejected, total=total)
    return {"accepted": accepted, "rejected": rejected, "total": total}
