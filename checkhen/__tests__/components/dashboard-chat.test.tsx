import { render, screen } from '@testing-library/react';
import DashboardChat, { newestFirst } from '@/components/Admin/DashboardChat';

const message = (id: string, createdAt: string) => ({ id, createdAt });
const older = message('older', '2026-10-29T14:00:00Z');
const newer = message('newer', '2026-10-29T15:00:00Z');
const tied = message('tied', '2026-10-29T15:00:00+00:00');

type Message = typeof older;
function Chat({ messages, scope = 'one' }: { messages: Message[]; scope?: string }) {
  return (
    <DashboardChat key={scope} narrow={false}>
      {newestFirst(messages).map((item) => (
        <div key={item.id} data-message-id={item.id}>
          {item.id}
        </div>
      ))}
    </DashboardChat>
  );
}
const order = () => Array.from(screen.getByRole('region').children).map((node) => node.textContent);

afterEach(() => jest.restoreAllMocks());

it('renders chronological order without mutating input and keeps ties stable across refreshes', () => {
  const messages = Object.freeze([older, tied, newer]);
  expect(newestFirst(messages).map((item) => item.id)).toEqual(['newer', 'tied', 'older']);
  expect(messages).toEqual([older, tied, newer]);
  const view = render(<Chat messages={[older, tied, newer]} />);
  expect(order()).toEqual(['newer', 'tied', 'older']);
  view.rerender(<Chat messages={[newer, older, tied].map((item) => ({ ...item }))} />);
  expect(order()).toEqual(['newer', 'tied', 'older']);
  view.rerender(
    <Chat messages={[older, message('latest', '2026-10-29T16:00:00Z'), newer, tied]} />
  );
  expect(order()).toEqual(['latest', 'newer', 'tied', 'older']);
});

function mockLayout() {
  // Each rendered row occupies 100px, with coordinates relative to scrollTop.
  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    const viewport = this.closest('[role="region"]') as HTMLElement;
    const index = this.hasAttribute('data-message-id')
      ? Array.from(viewport.children).indexOf(this)
      : 0;
    const top = this.hasAttribute('data-message-id') ? index * 100 - viewport.scrollTop : 0;
    return {
      top,
      bottom: top + 100,
      height: 100,
      left: 0,
      right: 100,
      width: 100,
      x: 0,
      y: top,
      toJSON() {},
    };
  });
}

it('opens at the live top and keeps arrivals visible there', () => {
  mockLayout();
  const view = render(<Chat messages={[older]} />);
  const viewport = screen.getByRole('region');
  expect(viewport.scrollTop).toBe(0);
  view.rerender(<Chat messages={[older, newer]} />);
  expect(viewport.scrollTop).toBe(0);
  expect(viewport.firstElementChild).toHaveTextContent('newer');
});

it('preserves the visible message offset on prepends and does not write scrollTop for unchanged polling', () => {
  mockLayout();
  const view = render(<Chat messages={[older, newer]} />);
  const viewport = screen.getByRole('region');
  viewport.scrollTop = 120;
  const anchor = screen.getByText('older');
  expect(anchor.getBoundingClientRect().top).toBe(-20);
  view.rerender(<Chat messages={[older, newer, tied]} />);
  expect(viewport.scrollTop).toBe(220);
  expect(anchor.getBoundingClientRect().top).toBe(-20);
  const setter = jest.spyOn(viewport, 'scrollTop', 'set');
  view.rerender(<Chat messages={[tied, newer, older].map((item) => ({ ...item }))} />);
  expect(setter).not.toHaveBeenCalled();
  expect(anchor.getBoundingClientRect().top).toBe(-20);
});

it('resets the viewport when the course/session scope changes', () => {
  const view = render(<Chat messages={[older, newer]} />);
  screen.getByRole('region').scrollTop = 120;
  view.rerender(<Chat scope="two" messages={[older]} />);
  expect(screen.getByRole('region').scrollTop).toBe(0);
});
