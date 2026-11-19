import Link from "next/link";

export default function CheckoutSuccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f7f5] px-5">
      <section className="max-w-lg rounded-2xl bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-bold">Thanks for your order</h1>
        <p className="mt-3 text-sm leading-6 text-neutral-600">
          Stripe is confirming your payment. The order and listing status update
          from Stripe’s signed webhook, so this page alone does not confirm
          payment.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex rounded-lg bg-[#587a3b] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#486630]"
        >
          Return to listings
        </Link>
      </section>
    </main>
  );
}
