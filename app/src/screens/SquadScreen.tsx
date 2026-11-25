import type { EventDetail } from "../domain/models";
import { AttendanceScreen } from "./AttendanceScreen";

type SquadScreenProps = {
  event: EventDetail;
  onBack: () => void;
  userInstrument?: string;
};

export function SquadScreen({ event, onBack, userInstrument }: SquadScreenProps) {
  return <AttendanceScreen event={event} onBack={onBack} userInstrument={userInstrument} />;
}
