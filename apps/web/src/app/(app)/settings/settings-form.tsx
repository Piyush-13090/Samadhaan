'use client';

import { useState } from 'react';
import { CURRENT_USER } from '@/data/people';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SwitchField } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';

/**
 * Settings form.
 *
 * Client-side only: it validates nothing and saves nothing. Its purpose in this
 * milestone is to exercise the form components together — label wiring, hints,
 * error state, character counting and the toast confirmation — so the patterns
 * are settled before real forms are built on them.
 */
export function SettingsForm() {
  const { toast } = useToast();
  const [bio, setBio] = useState(
    'Resident of Sector 12. Interested in drainage and pedestrian safety.',
  );
  const [saving, setSaving] = useState(false);

  function handleSave() {
    setSaving(true);
    // Stands in for the request the auth milestone will make.
    setTimeout(() => {
      setSaving(false);
      toast({
        tone: 'success',
        title: 'Settings saved',
        description: 'Your profile has been updated.',
      });
    }, 700);
  }

  return (
    <div className="mt-8 space-y-5">
      <Alert tone="info" title="Preview only">
        This form is part of the design system preview. Saving is enabled once accounts
        are implemented.
      </Alert>

      <Card>
        <CardHeader title="Profile" description="How you appear to other people." />
        <CardBody className="space-y-5">
          <Field label="Full name" required>
            <Input defaultValue={CURRENT_USER.name} autoComplete="name" />
          </Field>

          <Field label="Display name" hint="Used for mentions and on the leaderboard.">
            <Input defaultValue="priya" autoComplete="nickname" />
          </Field>

          <Field label="Email" required error="Enter a valid email address">
            <Input type="email" defaultValue="priya@example" autoComplete="email" />
          </Field>

          <Field label="About" hint="A sentence about your interest in the area.">
            <Textarea
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              maxLength={240}
              showCount
              rows={3}
            />
          </Field>

          <Field label="Primary area" hint="Used to show problems near you.">
            <Select defaultValue="sector-12">
              <SelectTrigger>
                <SelectValue placeholder="Choose an area" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sector-9">Sector 9</SelectItem>
                <SelectItem value="sector-12">Sector 12</SelectItem>
                <SelectItem value="sector-15">Sector 15</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </CardBody>

        <CardFooter className="justify-end">
          <Button variant="ghost">Cancel</Button>
          <Button variant="primary" loading={saving} onClick={handleSave}>
            Save changes
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader title="Notifications" description="What we tell you about." />
        <CardBody className="space-y-4">
          <SwitchField
            defaultChecked
            label="Problem updates"
            description="When a problem you reported or support changes status."
          />
          <SwitchField
            defaultChecked
            label="AI analysis"
            description="When Samadhaan AI finishes analysing one of your reports."
          />
          <SwitchField
            label="Weekly summary"
            description="A digest of activity in your area."
          />
        </CardBody>
      </Card>
    </div>
  );
}
