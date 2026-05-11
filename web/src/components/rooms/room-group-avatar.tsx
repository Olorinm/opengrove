function roomTitleInitial(title: string): string {
  const chars = Array.from(title.trim()).filter((char) => /\S/.test(char));
  const han = chars.find((char) => /[\u3400-\u9fff]/.test(char));
  return (han || chars[0] || "#").toUpperCase();
}

export function RoomGroupAvatar(props: { title: string; className: string }) {
  return (
    <span className={`${props.className} room-group-avatar`} aria-hidden="true" title={props.title}>
      {roomTitleInitial(props.title)}
    </span>
  );
}
