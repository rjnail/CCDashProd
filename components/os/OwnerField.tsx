import { eligibleOwners, MEMBERSHIP_EMPTY_NOTE } from "@/lib/os/owners";

export function OwnerField({
  id,
  members,
  value,
  onChange,
  allowUnassigned = true,
  emptyLabel,
  itemTitle,
  className,
}: {
  id: string;
  members: readonly { id: string; name: string }[];
  value: string;
  onChange: (ownerUserId: string) => void;
  allowUnassigned?: boolean;
  emptyLabel?: string;
  itemTitle?: string;
  className?: string;
}) {
  const options = eligibleOwners(members);
  const selected = options.some((member) => member.id === value) ? value : "";
  const hintId = options.length === 0 ? `${id}-hint` : undefined;
  const placeholder = emptyLabel ?? (allowUnassigned ? "Unassigned" : "Choose an owner");
  return (
    <div className={className ? `owner-field ${className}` : "owner-field"}>
      <label htmlFor={id}>
        <span>Owner</span>
        {itemTitle ? <span className="sr-only"> for {itemTitle}</span> : null}
        <select
          id={id}
          value={selected}
          required={!allowUnassigned}
          aria-describedby={hintId}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{placeholder}</option>
          {options.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </label>
      {hintId ? (
        <p className="mini" id={hintId}>
          {MEMBERSHIP_EMPTY_NOTE}
        </p>
      ) : null}
    </div>
  );
}
