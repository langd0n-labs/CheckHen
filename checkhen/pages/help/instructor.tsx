import type { GetServerSideProps } from 'next';
import { getServerSession } from 'next-auth';
import { Alert, Text } from '@mantine/core';
import { HelpLayout, HelpList as List } from '@/components/HelpLayout';
import { isInstructor } from '@/lib/request-scope';
import { authOptions } from '../api/auth/[...nextauth]';

/** Instructor help describes grading and draw rules, so only instructors may read it. */
export const getServerSideProps: GetServerSideProps = async ({ req, res }) => {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return {
      redirect: { destination: '/api/auth/signin?callbackUrl=/help/instructor', permanent: false },
    };
  }
  return isInstructor(session.user.email) ? { props: {} } : { notFound: true };
};

/** Help for instructors: the dashboard, cold calling, and exam mode. */
export default function InstructorHelp() {
  return (
    <HelpLayout
      title="How CheckHen works for instructors"
      intro="The dashboard runs the class, the cold-call screen runs on your phone, and exam mode limits the class network during a test."
      back={{ href: '/admin/dashboard', label: 'Back to the dashboard' }}
      sections={[
        {
          id: 'dashboard',
          title: 'The dashboard',
          body: (
            <>
              <Text>
                Choose the course and class session at the top of the page. Start New Class opens a
                session; End Class closes it, checks everyone out, and removes their class network
                access.
              </Text>
              <List>
                <List.Item>
                  Present students: everyone checked in. Open a student to see their profile,
                  including food allergies and bio, which students never see about each other.
                </List.Item>
                <List.Item>
                  Hands raised: in the order raised. Acknowledge calls on that student. An
                  acknowledged hand counts as a volunteer answer, and that student is a little less
                  likely to be drawn for a cold call in the same meeting.
                </List.Item>
                <List.Item>
                  Pace: how many students chose Slow down or Ready. A notice appears when more than
                  30% want to slow down. Reset clears the counts.
                </List.Item>
                <List.Item>
                  Chat: you see real names. Hide removes a message for students and the projector
                  within about a second; the message stays in the record and Unhide restores it.
                  Mute stops a student from sending messages for the rest of the class.
                </List.Item>
                <List.Item>
                  Project chat opens the projection window; Copy Slidev token connects a Slidev
                  deck. See the projection help for what the room sees.
                </List.Item>
              </List>
            </>
          ),
        },
        {
          id: 'cold-call',
          title: 'Cold calling',
          body: (
            <>
              <Text>
                Open the cold-call screen on your phone. Tap Call on someone; CheckHen draws a
                checked-in student and shows their photo, name, pronunciation, and pronouns. Tap one
                outcome. The common path is two taps: Call on someone, then Answered. This screen is
                for you only; it is not designed to be projected.
              </Text>
              <Text fw={600}>Outcomes</Text>
              <List>
                <List.Item>
                  Answered: the student answered. It counts toward participation.
                </List.Item>
                <List.Item>
                  Answered + follow-up: records Answered and keeps the same student on screen for a
                  deeper or variant question. See follow-up runs below.
                </List.Item>
                <List.Item>
                  Pass: the student did not answer. It is an opportunity without an answer, and it
                  makes the student more likely to be drawn later, until they answer.
                </List.Item>
                <List.Item>
                  Retry: come back to this student. Nothing is recorded as an answer or pass yet.
                  The student comes back by chance, at three times their usual weight; record the
                  outcome when you return to them.
                </List.Item>
                <List.Item>
                  Absent: the student left early. It counts as an absence and checks the student
                  out. They can be drawn again after they check back in.
                </List.Item>
                <List.Item>
                  Skip: the student is briefly out of the room. It is noted, changes nothing, and
                  the student stays in the draw.
                </List.Item>
              </List>
              <Text fw={600}>Follow-up runs</Text>
              <List>
                <List.Item>
                  Each follow-up question is its own record, and each Answered counts toward
                  participation. A run counts as one call for how recently the student was called.
                </List.Item>
                <List.Item>
                  A Pass on a follow-up costs nothing: it is not an opportunity and adds no pass
                  weight. It still settles an outstanding Retry.
                </List.Item>
                <List.Item>
                  Done with follow-ups ends the run. After a plain Answered, Ask a follow-up starts
                  one.
                </List.Item>
                <List.Item>
                  If a Retry on a follow-up is resolved later by a fresh draw, that later call is an
                  ordinary call: a Pass on it counts.
                </List.Item>
              </List>
              <Text fw={600}>Undo</Text>
              <List>
                <List.Item>
                  Undo has no time limit. The last call has an Undo, and every earlier call in the
                  session is listed with its own. Recording a corrected outcome on the same card
                  works for 30 minutes after the draw; after that, call on the student again.
                </List.Item>
                <List.Item>
                  During a run, or right after an outcome that ended one, Undo steps back one
                  question with the same student, so you can record the right outcome.
                </List.Item>
                <List.Item>Undoing an Absent also checks the student back in.</List.Item>
                <List.Item>
                  Undoing the first call of a run keeps its follow-ups, which were real questions.
                  They stay counted and are labeled (follow-up).
                </List.Item>
              </List>
              <Text fw={600}>Who gets drawn</Text>
              <List>
                <List.Item>
                  Any checked-in student on the roster can be drawn, except one marked Absent in
                  this meeting who has not checked back in.
                </List.Item>
                <List.Item>
                  A student called earlier in the same meeting stays in the draw at a fifth of their
                  usual weight, so being called does not take them off the hook.
                </List.Item>
                <List.Item>
                  Weight rises for students never called, for each meeting since they were last
                  called, for outstanding passes, and for an outstanding Retry. It falls after an
                  acknowledged hand in the same meeting. The weights are course settings.
                </List.Item>
              </List>
              <Text fw={600}>Two phones</Text>
              <Text>
                If you draw on two phones, the newer draw replaces the older one. The older phone
                keeps showing its card until its next tap; that tap is refused, and the card clears
                with a notice. A draw stays valid for 30 minutes.
              </Text>
            </>
          ),
        },
        {
          id: 'modes',
          title: 'Classroom and hosted mode',
          body: (
            <>
              <Text>
                In classroom mode, CheckHen runs behind its own Wi-Fi access point. Students check
                in by joining that network, and exam mode is available.
              </Text>
              <Text>
                In hosted mode, CheckHen runs at a regular web address with no access point. You
                take attendance with roll call on the cold-call screen, and exam mode is not
                available. Chat, hands, pace, cold calling, the course record, and projection work
                the same in both modes.
              </Text>
            </>
          ),
        },
        {
          id: 'exam-mode',
          title: 'Exam mode',
          body: (
            <>
              <Alert color="yellow" title="Being finished">
                Exam mode is being finished. Do not use it in class yet.
              </Alert>
              <Text>
                On the dashboard, enter the allowed domains and the disconnect limit in seconds (30
                by default, 10 at least), then tap Start exam and confirm. While the exam runs:
              </Text>
              <List>
                <List.Item>
                  Students reach only CheckHen and the allowed domains. Devices that were not
                  already checked in cannot join.
                </List.Item>
                <List.Item>
                  A student who opened an allowed site before the start may need to reload it once.
                </List.Item>
                <List.Item>
                  The allowlist works by network address. A site served from a shared content
                  network (Cloudflare, Fastly, CloudFront) shares addresses with other sites, so
                  a determined student may reach some of those too. Prefer allowed sites that
                  are hosted on their own.
                </List.Item>
                <List.Item>
                  CheckHen watches each student&apos;s exam device: the device they checked in with
                  first. Both its open class page and its Wi-Fi connection count; another device
                  does not. A student whose exam device CheckHen has not heard from for longer than
                  the limit gets an automatic fail, shown on the dashboard. The time counts from the
                  last time CheckHen heard the device, which can be a few seconds before it left.
                  Tell students to take the exam on the device they checked in with first.
                </List.Item>
                <List.Item>
                  Excuse a fail with a reason. The fail stays in the record, marked excused. Each
                  disconnection is its own fail, so a student excused once can fail again on a later
                  drop. Fails stay listed after the exam ends and can still be excused.
                </List.Item>
                <List.Item>
                  End exam restores the normal class network. Ending the session also ends the exam.
                </List.Item>
              </List>
            </>
          ),
        },
      ]}
    />
  );
}
