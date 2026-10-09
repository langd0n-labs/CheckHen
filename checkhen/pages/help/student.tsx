import { Alert, Text } from '@mantine/core';
import { HelpLayout, HelpList as List } from '@/components/HelpLayout';

/** Help for students: checking in, chat, hands, pace, profile, and exam mode. */
export default function StudentHelp() {
  return (
    <HelpLayout
      title="How CheckHen works for students"
      intro="CheckHen takes attendance, carries the class chat, and lets you raise your hand or tell your instructor about the pace."
      back={{ href: '/', label: 'Back to class' }}
      sections={[
        {
          id: 'checking-in',
          title: 'Checking in and out',
          body: (
            <>
              <Text>
                To check in, join the class Wi-Fi, open the join page, sign in with your BU Google
                account, choose your course and today&apos;s session, and tap Join Session. Checking
                in again on a second device does not change your attendance.
              </Text>
              <Text>You are checked out when any of these happens:</Text>
              <List>
                <List.Item>You tap the CheckHen logo (Leave class).</List.Item>
                <List.Item>
                  You close or reload the class page. Reloading checks you out too, so join again
                  afterward. Some phones, iPhones especially, do not report a closed page, so use
                  Leave class when you leave.
                </List.Item>
                <List.Item>
                  Your device&apos;s address on the class Wi-Fi expires. That can take hours after
                  you leave the room, so use Leave class if you leave early.
                </List.Item>
                <List.Item>The session ends.</List.Item>
                <List.Item>
                  Your instructor calls on you and marks you Absent, because you left early.
                </List.Item>
              </List>
              <Text>
                Leaving from the device you checked in with checks you out and ends class network
                access for all your devices. Leaving from a second device ends only that
                device&apos;s access; you stay checked in.
              </Text>
              <Text>To check in again, open the join page and join the session again.</Text>
              <Text>
                When CheckHen runs at a regular web address instead of the class Wi-Fi, your
                instructor takes attendance by roll call.
              </Text>
            </>
          ),
        },
        {
          id: 'chat',
          title: 'Chat',
          body: (
            <>
              <Text>
                In the class chat, classmates and the projector see you only by an anonymous name,
                such as Swift Panda. Your instructor sees your real name.
              </Text>
              <Text>
                Your instructor can hide a message: it disappears for everyone, including the
                projector. Your instructor can also mute you for the rest of the class; while you
                are muted, you cannot send messages.
              </Text>
            </>
          ),
        },
        {
          id: 'hands-and-pace',
          title: 'Raising your hand and pace signals',
          body: (
            <>
              <Text>
                Raise Hand puts you in your instructor&apos;s queue. Tap again to lower it. Your
                instructor sees who raised a hand and in what order.
              </Text>
              <Text>
                Slow down and Ready tell your instructor how the pace feels. The numbers show how
                many classmates chose each one; your instructor can reset them.
              </Text>
            </>
          ),
        },
        {
          id: 'called-on',
          title: 'Being called on',
          body: (
            <Text>
              Your instructor may call on you during class. No student screen shows anything about
              these calls.
            </Text>
          ),
        },
        {
          id: 'profile',
          title: 'Your profile and who sees it',
          body: (
            <>
              <Text>
                Your display name, its pronunciation, your pronouns, and your photo help your
                instructor call on you by name. Only your instructor sees them; classmates and the
                projector see your anonymous name.
              </Text>
              <Text>Your food allergies and bio are shown only to your instructor.</Text>
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
                During an exam, only the websites your instructor allows will load. A banner at the
                top of the class page lists them.
              </Text>
              <Text>
                Take the exam on the device you checked in with first, keep the class page open on
                it, and stay on the class Wi-Fi. CheckHen watches only that device; a class page
                open on another device does not count. If CheckHen hears nothing from it for longer
                than the limit your instructor set (30 seconds unless they chose another), CheckHen
                records an automatic fail. The time counts from the last time CheckHen heard your
                device, which can be a few seconds before it disconnected. Raise your hand if that happens; your instructor can excuse the
                fail with a reason.
              </Text>
            </>
          ),
        },
      ]}
    />
  );
}
