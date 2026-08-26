import { PaymentDetail } from "@/components/payment-detail";

export default async function PaymentDetailPage({ params }: { params: Promise<{ paymentId: string }> }) {
  return <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12"><PaymentDetail paymentId={(await params).paymentId} /></main>;
}
