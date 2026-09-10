import React, {useMemo, useRef, useState} from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  NativeModules,
  PermissionsAndroid,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';

type ContactStatus = 'pending' | 'sending' | 'sent' | 'failed';

type Contact = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  row?: number;
  sheet?: string;
  status: ContactStatus;
  message?: string;
  error?: string;
};

type ParsedContacts = {
  contacts: Array<{
    firstName?: string;
    lastName?: string;
    phone: string;
    row?: number;
    sheet?: string;
  }>;
  warnings?: string[];
  totalRows?: number;
  headerRow?: number;
  sourceType?: string;
  sheetCount?: number;
};

type ExcelContactsModule = {
  pickAndParse: () => Promise<string>;
};

type SmsSenderModule = {
  sendSms: (
    phoneNumber: string,
    message: string,
  ) => Promise<{phone: string; parts: number}>;
};

const {ExcelContacts, SmsSender} = NativeModules as {
  ExcelContacts?: ExcelContactsModule;
  SmsSender?: SmsSenderModule;
};

const DEFAULT_TEMPLATE =
  "Assalomu alaykum {{ism}} {{familiya}}. Siz uchun muhim xabar: shablonni shu yerda o'zgartiring.";

const SAMPLE_CONTACT: Contact = {
  id: 'sample',
  firstName: 'Ali',
  lastName: 'Valiyev',
  phone: '+998901234567',
  status: 'pending',
};

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor="#F6F7F9" />
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}>
          <SmsPlatform />
        </KeyboardAvoidingView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function SmsPlatform() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [delaySeconds, setDelaySeconds] = useState('2.5');
  const [hasConsent, setHasConsent] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [sourceLabel, setSourceLabel] = useState('Fayl tanlanmagan');
  const stopRequestedRef = useRef(false);

  const counters = useMemo(() => {
    return contacts.reduce(
      (acc, contact) => {
        acc.total += 1;
        acc[contact.status] += 1;
        return acc;
      },
      {total: 0, pending: 0, sending: 0, sent: 0, failed: 0},
    );
  }, [contacts]);

  const previewText = useMemo(() => {
    const previewContact = contacts[0] ?? SAMPLE_CONTACT;
    return renderTemplate(template, previewContact);
  }, [contacts, template]);

  const canSend =
    contacts.length > 0 && !isSending && template.trim().length > 0 && hasConsent;

  async function importContacts() {
    if (!ExcelContacts?.pickAndParse) {
      Alert.alert('Modul topilmadi', 'Ilovani qurilmada ishga tushiring.');
      return;
    }

    setIsImporting(true);
    try {
      const raw = await ExcelContacts.pickAndParse();
      const parsed = JSON.parse(raw) as ParsedContacts;
      const nextContacts = (parsed.contacts ?? []).map((contact, index) => ({
        id: `${contact.phone}-${contact.row ?? index}`,
        firstName: contact.firstName ?? '',
        lastName: contact.lastName ?? '',
        phone: contact.phone,
        row: contact.row,
        sheet: contact.sheet,
        status: 'pending' as ContactStatus,
      }));

      setContacts(nextContacts);
      setWarnings(parsed.warnings ?? []);
      const sheetInfo =
        parsed.sheetCount && parsed.sheetCount > 1
          ? `, ${parsed.sheetCount} ta bo'lim`
          : '';
      setSourceLabel(
        `${nextContacts.length} ta kontakt yuklandi${
          parsed.sourceType ? ` (${parsed.sourceType}${sheetInfo})` : ''
        }`,
      );

      if (nextContacts.length === 0) {
        Alert.alert('Kontakt topilmadi', "Faylda telefon raqam ustuni borligini tekshiring.");
      }
    } catch (error) {
      Alert.alert('Import xatosi', getErrorMessage(error));
    } finally {
      setIsImporting(false);
    }
  }

  function confirmSend() {
    if (!contacts.length) {
      Alert.alert('Kontakt yoq', 'Avval Excel yoki CSV fayl yuklang.');
      return;
    }

    if (!template.trim()) {
      Alert.alert('Shablon bosh', 'SMS shablon matnini kiriting.');
      return;
    }

    if (!hasConsent) {
      Alert.alert('Rozilik kerak', 'Faqat SMS olishga rozi kontaktlarga yuboring.');
      return;
    }

    const pendingCount = contacts.filter(contact => contact.status !== 'sent').length;
    if (pendingCount === 0) {
      Alert.alert('Hammasi yuborilgan', 'Yuborilmagan kontakt qolmadi.');
      return;
    }

    const iosNote =
      Platform.OS === 'ios'
        ? '\n\nHar bir SMS uchun alohida "Send" tugmasini bosishingiz kerak.'
        : '';
    Alert.alert(
      'Yuborishni tasdiqlang',
      `${pendingCount} ta SMS ${
        Platform.OS === 'ios'
          ? 'yuboriladi'
          : 'telefon SIM kartasidan ketma-ket yuboriladi'
      }.${iosNote}`,
      [
        {text: 'Bekor', style: 'cancel'},
        {text: 'Boshlash', onPress: () => void sendAll()},
      ],
    );
  }

  async function sendAll() {
    if (!SmsSender?.sendSms) {
      Alert.alert('Modul topilmadi', 'Ilovani qurilmada ishga tushiring.');
      return;
    }

    const permissionGranted = await requestSmsPermission();
    if (!permissionGranted) {
      Alert.alert('SMS ruxsati yoq', 'Android sozlamalaridan SMS yuborish ruxsatini bering.');
      return;
    }

    stopRequestedRef.current = false;
    setIsSending(true);

    const queue = contacts.filter(contact => contact.status !== 'sent');
    const delayMs = parseDelay(delaySeconds);

    for (const contact of queue) {
      if (stopRequestedRef.current) {
        break;
      }

      const message = renderTemplate(template, contact);
      updateContact(contact.id, {status: 'sending', message, error: undefined});

      try {
        await SmsSender.sendSms(contact.phone, message);
        updateContact(contact.id, {status: 'sent', message, error: undefined});
      } catch (error) {
        updateContact(contact.id, {
          status: 'failed',
          message,
          error: getErrorMessage(error),
        });
      }

      if (!stopRequestedRef.current) {
        await waitWithStop(delayMs, stopRequestedRef);
      }
    }

    setIsSending(false);
  }

  function stopSending() {
    stopRequestedRef.current = true;
  }

  function resetStatuses() {
    if (isSending) {
      return;
    }
    setContacts(current =>
      current.map(contact => ({
        ...contact,
        status: 'pending',
        message: undefined,
        error: undefined,
      })),
    );
  }

  function updateContact(id: string, patch: Partial<Contact>) {
    setContacts(current =>
      current.map(contact => (contact.id === id ? {...contact, ...patch} : contact)),
    );
  }

  return (
    <FlatList
      data={contacts}
      keyExtractor={item => item.id}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
      ListHeaderComponent={
        <View>
          <View style={styles.header}>
            <View style={styles.headerTitleGroup}>
              <View style={styles.logoBadge}>
                <Text style={styles.logoIcon}>💬</Text>
              </View>
              <View>
                <Text style={styles.title}>SMS Platforma</Text>
                <Text style={styles.subtitle}>Excel kontaktlar va SMS yuborish</Text>
              </View>
            </View>
            <View style={styles.totalBadge}>
              <Text style={styles.totalBadgeNumber}>{counters.total}</Text>
              <Text style={styles.totalBadgeLabel}>kontakt</Text>
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.rowBetween}>
              <View style={styles.flex}>
                <Text style={styles.label}>Kontakt fayli</Text>
                <Text style={styles.valueText}>{sourceLabel}</Text>
              </View>
              <ActionButton
                label={isImporting ? 'Yuklanmoqda' : 'Import'}
                onPress={importContacts}
                disabled={isImporting || isSending}
              />
            </View>

            {warnings.length > 0 ? (
              <View style={styles.warningBox}>
                <Text style={styles.warningTitle}>Ogohlantirishlar</Text>
                {warnings.slice(0, 4).map((warning, index) => (
                  <Text key={`${warning}-${index}`} style={styles.warningText}>
                    {warning}
                  </Text>
                ))}
                {warnings.length > 4 ? (
                  <Text style={styles.warningText}>Yana {warnings.length - 4} ta yozuv.</Text>
                ) : null}
              </View>
            ) : null}
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>SMS shablon</Text>
            <TextInput
              value={template}
              onChangeText={setTemplate}
              multiline
              textAlignVertical="top"
              editable={!isSending}
              style={styles.templateInput}
              placeholder="{{ism}}, {{familiya}}, {{telefon}}"
              placeholderTextColor="#7B8494"
            />

            <View style={styles.previewBox}>
              <Text style={styles.previewLabel}>Namuna</Text>
              <Text style={styles.previewText}>{previewText}</Text>
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.rowBetween}>
              <View style={styles.delayGroup}>
                <Text style={styles.label}>Pauza, sekund</Text>
                <TextInput
                  value={delaySeconds}
                  onChangeText={setDelaySeconds}
                  editable={!isSending}
                  keyboardType="decimal-pad"
                  style={styles.delayInput}
                />
              </View>

              <Pressable
                disabled={isSending}
                onPress={() => setHasConsent(value => !value)}
                style={styles.consentRow}>
                <View style={[styles.checkbox, hasConsent && styles.checkboxChecked]}>
                  {hasConsent ? <View style={styles.checkboxDot} /> : null}
                </View>
                <Text style={styles.consentText}>Kontaktlar SMS olishga rozi</Text>
              </Pressable>
            </View>

            <View style={styles.actions}>
              {isSending ? (
                <ActionButton label="To'xtatish" onPress={stopSending} variant="danger" />
              ) : (
                <ActionButton label="SMS yuborish" onPress={confirmSend} disabled={!canSend} />
              )}
              <ActionButton
                label="Statusni tozalash"
                onPress={resetStatuses}
                disabled={isSending || contacts.length === 0}
                variant="secondary"
              />
            </View>

            <View style={styles.statsRow}>
              <Stat label="Kutilmoqda" value={counters.pending} tone="neutral" />
              <Stat label="Yuborildi" value={counters.sent} tone="success" />
              <Stat label="Xato" value={counters.failed} tone="danger" />
            </View>
          </View>

          <Text style={styles.listTitle}>Kontaktlar</Text>
        </View>
      }
      ListEmptyComponent={
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Kontaktlar hali yuklanmagan</Text>
          <Text style={styles.emptyText}>XLSX yoki CSV fayldan import qiling.</Text>
        </View>
      }
      renderItem={({item}) => <ContactRow contact={item} />}
    />
  );
}

function ContactRow({contact}: {contact: Contact}) {
  const fullName = `${contact.firstName} ${contact.lastName}`.trim() || 'Ism yoq';

  return (
    <View style={styles.contactRow}>
      <View style={styles.contactMain}>
        <View style={styles.contactHeaderRow}>
          <Text style={styles.contactName}>{fullName}</Text>
          {contact.sheet ? <Text style={styles.sheetTag}>{contact.sheet}</Text> : null}
        </View>
        <Text style={styles.contactPhone}>{contact.phone}</Text>
        {contact.error ? <Text style={styles.errorText}>{contact.error}</Text> : null}
      </View>
      <StatusPill status={contact.status} />
    </View>
  );
}

function StatusPill({status}: {status: ContactStatus}) {
  const labels: Record<ContactStatus, string> = {
    pending: 'Kutilmoqda',
    sending: 'Yuborilmoqda',
    sent: 'Yuborildi',
    failed: 'Xato',
  };

  const statusStyle = {
    pending: styles.status_pending,
    sending: styles.status_sending,
    sent: styles.status_sent,
    failed: styles.status_failed,
  }[status];

  return (
    <View style={[styles.statusPill, statusStyle]}>
      <Text style={[styles.statusText, status === 'sent' && styles.statusTextLight]}>
        {labels[status]}
      </Text>
    </View>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'neutral' | 'success' | 'danger';
}) {
  const toneStyle = {
    neutral: styles.stat_neutral,
    success: styles.stat_success,
    danger: styles.stat_danger,
  }[tone];

  return (
    <View style={styles.statItem}>
      <Text style={[styles.statNumber, toneStyle]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const variantStyle = {
    primary: styles.button_primary,
    secondary: styles.button_secondary,
    danger: styles.button_danger,
  }[variant];

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        variantStyle,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}>
      <Text
        style={[
          styles.buttonText,
          variant === 'secondary' && styles.buttonTextSecondary,
          disabled && styles.buttonTextDisabled,
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

async function requestSmsPermission() {
  if (Platform.OS !== 'android') {
    return true;
  }

  const permission = PermissionsAndroid.PERMISSIONS.SEND_SMS;
  const alreadyGranted = await PermissionsAndroid.check(permission);
  if (alreadyGranted) {
    return true;
  }

  const result = await PermissionsAndroid.request(permission, {
    title: 'SMS ruxsati',
    message: "Ilova telefon SIM kartasi orqali SMS yuborishi uchun ruxsat kerak.",
    buttonPositive: 'Ruxsat berish',
    buttonNegative: 'Bekor',
  });

  return result === PermissionsAndroid.RESULTS.GRANTED;
}

function renderTemplate(template: string, contact: Contact) {
  const fullName = `${contact.firstName} ${contact.lastName}`.trim();
  const replacements: Record<string, string> = {
    ism: contact.firstName,
    name: contact.firstName,
    firstname: contact.firstName,
    familiya: contact.lastName,
    familya: contact.lastName,
    lastname: contact.lastName,
    telefon: contact.phone,
    phone: contact.phone,
    fio: fullName,
    fish: fullName,
    fullname: fullName,
  };

  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    return replacements[key.toLowerCase()] ?? '';
  });
}

function parseDelay(value: string) {
  const seconds = Number(value.replace(',', '.'));
  if (!Number.isFinite(seconds)) {
    return 2500;
  }
  return Math.min(Math.max(seconds * 1000, 1000), 60000);
}

function wait(ms: number) {
  return new Promise<void>(resolve => {
    setTimeout(() => resolve(), ms);
  });
}

async function waitWithStop(ms: number, stopRef: {current: boolean}) {
  const step = 250;
  let elapsed = 0;

  while (elapsed < ms && !stopRef.current) {
    const nextStep = Math.min(step, ms - elapsed);
    await wait(nextStep);
    elapsed += nextStep;
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as {message?: unknown}).message);
  }

  return String(error);
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    backgroundColor: '#F6F7F9',
  },
  content: {
    padding: 16,
    paddingBottom: 32,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  headerTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoBadge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#1F7A5C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoIcon: {
    fontSize: 22,
  },
  title: {
    color: '#151B23',
    fontSize: 24,
    fontWeight: '800',
  },
  subtitle: {
    color: '#657084',
    fontSize: 13,
    marginTop: 2,
  },
  contactHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sheetTag: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1F7A5C',
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 6,
  },
  totalBadge: {
    minWidth: 78,
    borderRadius: 8,
    backgroundColor: '#203A59',
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  totalBadgeNumber: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
  },
  totalBadgeLabel: {
    color: '#DDE7F5',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  section: {
    borderWidth: 1,
    borderColor: '#D8DEE8',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 14,
    marginBottom: 12,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  label: {
    color: '#2D3645',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 6,
  },
  valueText: {
    color: '#626D7E',
    fontSize: 14,
  },
  warningBox: {
    borderLeftWidth: 4,
    borderLeftColor: '#B7791F',
    backgroundColor: '#FFF8E7',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 12,
  },
  warningTitle: {
    color: '#7A4A00',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 4,
  },
  warningText: {
    color: '#7A4A00',
    fontSize: 12,
    lineHeight: 18,
  },
  templateInput: {
    minHeight: 116,
    borderWidth: 1,
    borderColor: '#C8D0DB',
    borderRadius: 8,
    color: '#151B23',
    fontSize: 15,
    lineHeight: 21,
    padding: 12,
    backgroundColor: '#FBFCFE',
  },
  previewBox: {
    backgroundColor: '#EEF6F1',
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
  },
  previewLabel: {
    color: '#1F7A5C',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  previewText: {
    color: '#203128',
    fontSize: 14,
    lineHeight: 20,
  },
  delayGroup: {
    width: 118,
  },
  delayInput: {
    height: 44,
    borderWidth: 1,
    borderColor: '#C8D0DB',
    borderRadius: 8,
    color: '#151B23',
    fontSize: 16,
    paddingHorizontal: 12,
    backgroundColor: '#FBFCFE',
  },
  consentRow: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#8490A3',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  checkboxChecked: {
    borderColor: '#1F7A5C',
    backgroundColor: '#1F7A5C',
  },
  checkboxDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
  },
  consentText: {
    color: '#2D3645',
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  button: {
    minHeight: 44,
    borderRadius: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  button_primary: {
    backgroundColor: '#1F7A5C',
  },
  button_secondary: {
    borderWidth: 1,
    borderColor: '#B8C1CE',
    backgroundColor: '#FFFFFF',
  },
  button_danger: {
    backgroundColor: '#B42318',
  },
  buttonDisabled: {
    opacity: 0.46,
  },
  buttonPressed: {
    opacity: 0.82,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  buttonTextSecondary: {
    color: '#253244',
  },
  buttonTextDisabled: {
    color: '#E9EDF3',
  },
  statsRow: {
    borderTopWidth: 1,
    borderTopColor: '#E5E9F0',
    flexDirection: 'row',
    marginTop: 14,
    paddingTop: 12,
  },
  statItem: {
    flex: 1,
  },
  statNumber: {
    fontSize: 22,
    fontWeight: '800',
  },
  stat_neutral: {
    color: '#334155',
  },
  stat_success: {
    color: '#1F7A5C',
  },
  stat_danger: {
    color: '#B42318',
  },
  statLabel: {
    color: '#657084',
    fontSize: 12,
    marginTop: 2,
  },
  listTitle: {
    color: '#151B23',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 8,
    marginTop: 2,
  },
  emptyState: {
    borderWidth: 1,
    borderColor: '#D8DEE8',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    padding: 18,
    alignItems: 'center',
  },
  emptyTitle: {
    color: '#253244',
    fontSize: 15,
    fontWeight: '800',
  },
  emptyText: {
    color: '#657084',
    fontSize: 13,
    marginTop: 4,
  },
  contactRow: {
    minHeight: 76,
    borderWidth: 1,
    borderColor: '#D8DEE8',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    padding: 12,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  contactMain: {
    flex: 1,
  },
  contactName: {
    color: '#151B23',
    fontSize: 15,
    fontWeight: '800',
  },
  contactPhone: {
    color: '#657084',
    fontSize: 13,
    marginTop: 3,
  },
  errorText: {
    color: '#B42318',
    fontSize: 12,
    marginTop: 4,
  },
  statusPill: {
    minWidth: 104,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    alignItems: 'center',
  },
  status_pending: {
    backgroundColor: '#EEF1F5',
  },
  status_sending: {
    backgroundColor: '#E5EFFB',
  },
  status_sent: {
    backgroundColor: '#1F7A5C',
  },
  status_failed: {
    backgroundColor: '#FDECEC',
  },
  statusText: {
    color: '#253244',
    fontSize: 12,
    fontWeight: '800',
  },
  statusTextLight: {
    color: '#FFFFFF',
  },
});

export default App;
