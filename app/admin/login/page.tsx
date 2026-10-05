import { LoginForm } from "@/components/admin/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const error = Array.isArray(sp.error) ? sp.error[0] : sp.error;
  return (
    <main className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-6 text-2xl font-bold text-ink">Organiser sign in</h1>
      {error === "not_admin" && (
        <p role="alert" className="mb-4 rounded-md bg-danger-tint px-3 py-2 text-sm text-danger-dark">
          This account is not an organiser
        </p>
      )}
      <LoginForm />
    </main>
  );
}
