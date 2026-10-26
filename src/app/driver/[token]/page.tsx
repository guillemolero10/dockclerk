export default async function DriverPage({ params }: PageProps<"/driver/[token]">) {
  const { token } = await params;
  return (
    <main className="mx-auto w-full max-w-md px-4 py-12">
      <h1 className="text-2xl font-semibold">Delivery</h1>
      <p className="mt-2 text-neutral-500">Driver link {token.slice(0, 6)}… coming next.</p>
    </main>
  );
}
