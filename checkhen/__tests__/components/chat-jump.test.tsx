import { useRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ChatJump, useChatJump } from '@/lib/use-chat-jump';

let receive: (event: ChatJump) => void;
function Chat({
  classId = 'class',
  messages = ['old'],
}: {
  classId?: string;
  messages?: string[];
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const { jump, highlightedId } = useChatJump(classId, viewport);
  receive = jump;
  return (
    <div ref={viewport}>
      {messages.map((id) => (
        <div key={id} data-message-id={id} data-chat-highlight={highlightedId === id}>
          {id}
        </div>
      ))}
      <div data-message-id="hidden" data-hidden="true">
        Hidden
      </div>
      <input aria-label="Draft" defaultValue="" />
    </div>
  );
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('centers and highlights for eight seconds, preserves a draft, and restarts the timer on another jump', () => {
  const scroll = jest.spyOn(HTMLElement.prototype, 'scrollIntoView');
  render(<Chat messages={['old', 'new']} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Unsent question' } });
  act(() => receive({ classId: 'class', messageId: 'old' }));
  expect(scroll).toHaveBeenLastCalledWith({ block: 'center', behavior: 'smooth' });
  expect(scroll.mock.instances[0]).toBe(screen.getByText('old'));
  expect(screen.getByText('old')).toHaveAttribute('data-chat-highlight', 'true');
  act(() => jest.advanceTimersByTime(7999));
  expect(screen.getByText('old')).toHaveAttribute('data-chat-highlight', 'true');
  act(() => receive({ classId: 'class', messageId: 'new' }));
  expect(screen.getByText('old')).toHaveAttribute('data-chat-highlight', 'false');
  act(() => jest.advanceTimersByTime(7999));
  expect(screen.getByText('new')).toHaveAttribute('data-chat-highlight', 'true');
  act(() => jest.advanceTimersByTime(1));
  expect(screen.getByText('new')).toHaveAttribute('data-chat-highlight', 'false');
  expect(screen.getByRole('textbox')).toHaveValue('Unsent question');
});

it('ignores missing, hidden, malformed and other-class targets without replaying them after a refresh', () => {
  const scroll = jest.spyOn(HTMLElement.prototype, 'scrollIntoView');
  const view = render(<Chat />);
  act(() => {
    receive({ classId: 'other', messageId: 'old' });
    receive({ classId: 'class', messageId: 'missing' });
    receive({ classId: 'class', messageId: 'hidden' });
    receive(null as unknown as ChatJump);
  });
  view.rerender(<Chat messages={['old', 'missing']} />);
  expect(scroll).not.toHaveBeenCalled();
  expect(screen.getByText('missing')).toHaveAttribute('data-chat-highlight', 'false');
});

it('respects reduced motion and clears the highlight on a class change or unmount', () => {
  jest.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
  const scroll = jest.spyOn(HTMLElement.prototype, 'scrollIntoView');
  const view = render(<Chat />);
  act(() => receive({ classId: 'class', messageId: 'old' }));
  expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'instant' });
  view.rerender(<Chat classId="other" />);
  expect(screen.getByText('old')).toHaveAttribute('data-chat-highlight', 'false');
  act(() => receive({ classId: 'other', messageId: 'old' }));
  view.unmount();
  expect(jest.getTimerCount()).toBe(0);
});
