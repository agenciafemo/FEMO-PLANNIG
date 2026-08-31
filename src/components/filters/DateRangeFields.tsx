import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type DateRangeFieldsProps = {
  idPrefix: string;
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  fromLabel?: string;
  toLabel?: string;
};

export function DateRangeFields({
  idPrefix,
  from,
  to,
  onFromChange,
  onToChange,
  fromLabel = "Data de",
  toLabel = "Data até",
}: DateRangeFieldsProps) {
  return (
    <>
      <div className="min-w-[150px] flex-1 space-y-1 sm:max-w-[180px]">
        <Label htmlFor={`${idPrefix}-from`} className="text-[11px] text-muted-foreground">
          {fromLabel}
        </Label>
        <Input
          id={`${idPrefix}-from`}
          type="date"
          className="h-9"
          value={from}
          max={to || undefined}
          onChange={(event) => onFromChange(event.target.value)}
        />
      </div>
      <div className="min-w-[150px] flex-1 space-y-1 sm:max-w-[180px]">
        <Label htmlFor={`${idPrefix}-to`} className="text-[11px] text-muted-foreground">
          {toLabel}
        </Label>
        <Input
          id={`${idPrefix}-to`}
          type="date"
          className="h-9"
          value={to}
          min={from || undefined}
          onChange={(event) => onToChange(event.target.value)}
        />
      </div>
    </>
  );
}
