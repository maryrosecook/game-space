type IconMarkupProps = {
  markup: string;
};

export function IconMarkup({ markup }: IconMarkupProps) {
  return <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: markup }} />;
}
