import { CreditCard, Smartphone, Wallet } from "lucide-react";

// Payment options offered at checkout; shared by the cart checkout page and
// the event reserve dialog so both offer exactly the same methods.

export type PaymentChoice = {
  id: string;
  labelKey: string;
  icon: typeof CreditCard;
  paymentMethod: "stripe_card" | "ewallet" | "bank_transfer" | "wallet" | "wallet_split";
  paymentProvider: "tng_ewallet_simulator" | "grabpay_simulator" | "bank_transfer_simulator" | "toyyibpay" | null;
  simulated?: boolean;
};

const TOYYIBPAY_ENABLED = process.env.NEXT_PUBLIC_TOYYIBPAY_ENABLED === "true";
export const TOYYIBPAY_SANDBOX = process.env.NEXT_PUBLIC_TOYYIBPAY_ENV !== "production";

const ALL_METHODS = [
  { id: "stripe_card", labelKey: "strictMigration.checkout.methods.stripeCard", icon: CreditCard, paymentMethod: "stripe_card", paymentProvider: null },
  { id: "tng_ewallet", labelKey: "strictMigration.checkout.methods.tng", icon: Smartphone, paymentMethod: "ewallet", paymentProvider: "tng_ewallet_simulator", simulated: true },
  { id: "grabpay", labelKey: "strictMigration.checkout.methods.grabpay", icon: Smartphone, paymentMethod: "ewallet", paymentProvider: "grabpay_simulator", simulated: true },
  { id: "bank_transfer", labelKey: "strictMigration.checkout.methods.bankTransfer", icon: CreditCard, paymentMethod: "bank_transfer", paymentProvider: "bank_transfer_simulator", simulated: true },
  { id: "toyyibpay", labelKey: TOYYIBPAY_SANDBOX ? "strictMigration.checkout.methods.toyyibpaySandbox" : "strictMigration.checkout.methods.toyyibpay", icon: CreditCard, paymentMethod: "bank_transfer", paymentProvider: "toyyibpay" },
  { id: "wallet", labelKey: "strictMigration.checkout.methods.wallet", icon: Wallet, paymentMethod: "wallet", paymentProvider: null },
  { id: "wallet_split", labelKey: "strictMigration.checkout.methods.walletSplit", icon: Wallet, paymentMethod: "wallet_split", paymentProvider: null },
] satisfies PaymentChoice[];

export const PAYMENT_CHOICES: PaymentChoice[] = ALL_METHODS.filter(
  (choice) => (choice.id !== "toyyibpay" || TOYYIBPAY_ENABLED)
    && (!choice.simulated || process.env.NODE_ENV !== "production"),
);
