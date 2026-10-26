// Plain GET form: filters live in the URL, like the old software's toolbar.
export function LegacyFilters({
  clients,
  clientId,
  statuses,
  status,
}: {
  clients: { id: string; name: string }[];
  clientId?: string;
  statuses?: { value: string; label: string }[];
  status?: string;
}) {
  return (
    <form className="flex flex-wrap items-center gap-2 border-b border-[#808080] bg-[#d4d0c8] px-2 py-1.5">
      <label>
        Cliente:{" "}
        <select name="client" defaultValue={clientId ?? ""} className="legacy-input">
          <option value="">(todos)</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>
      {statuses && (
        <label>
          Estado:{" "}
          <select name="status" defaultValue={status ?? ""} className="legacy-input">
            <option value="">(todos)</option>
            {statuses.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </label>
      )}
      <button className="legacy-btn">Filtrar</button>
    </form>
  );
}
