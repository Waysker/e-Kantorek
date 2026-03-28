import type { EventDetail } from "../domain/models";
import { AttendanceScreen } from "./AttendanceScreen";

type SquadScreenProps = {
  event: EventDetail;
  onBack: () => void;
};

export function SquadScreen({ event, onBack }: SquadScreenProps) {
  return <AttendanceScreen event={event} onBack={onBack} />;
}
