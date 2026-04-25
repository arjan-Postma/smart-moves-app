import React, { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { t } from '../lib/i18n';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  StyleSheet,
  Platform,
  Linking,
} from 'react-native';
import HelpOverlay from '../components/HelpOverlay';

function openUrl(url: string) {
  if (Platform.OS === 'web') {
    (globalThis as any).window?.open(url, '_blank');
  } else {
    Linking.openURL(url);
  }
}

const logo = require('../../assets/futures-academy-logo.png');

export default function ProfileScreen() {
  const { language, setLanguage } = useLanguage();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  return (
    <View style={styles.root}>
      <HelpOverlay visible={showHelp} onClose={() => setShowHelp(false)} />

      {/* ── White form section ── */}
      <View style={styles.formSection}>
        {/* Language picker */}
        <View style={styles.langRow}>
          <Text style={styles.langLabel}>{t(language, 'lang_label')}: </Text>
          <TouchableOpacity
            style={[styles.langBtn, language === 'en' && styles.langBtnActive]}
            onPress={() => setLanguage('en')}
          >
            <Text style={[styles.langBtnText, language === 'en' && styles.langBtnTextActive]}>EN</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.langBtn, language === 'nl' && styles.langBtnActive]}
            onPress={() => setLanguage('nl')}
          >
            <Text style={[styles.langBtnText, language === 'nl' && styles.langBtnTextActive]}>NL</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.heading}>{t(language, 'profile_heading')}</Text>

        {Platform.OS === 'web'
          ? (React.createElement as any)('input', {
              key: 'name',
              style: {
                height: 56,
                border: '1.5px solid #111',
                borderRadius: 4,
                paddingLeft: 16,
                paddingRight: 16,
                fontSize: 16,
                color: '#111',
                background: '#FFF',
                outline: 'none',
                width: '100%',
                boxSizing: 'border-box',
                marginBottom: 12,
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
              },
              placeholder: t(language, 'profile_name'),
              value: name,
              onChange: (e: any) => setName(e.target.value),
              type: 'text',
            })
          : (
            <TextInput
              style={styles.input}
              placeholder={t(language, 'profile_name')}
              placeholderTextColor="#AAA"
              value={name}
              onChangeText={setName}
              autoCapitalize="none"
              autoCorrect={false}
            />
          )}

        {Platform.OS === 'web'
          ? (React.createElement as any)('input', {
              key: 'password',
              style: {
                height: 56,
                border: '1.5px solid #111',
                borderRadius: 4,
                paddingLeft: 16,
                paddingRight: 16,
                fontSize: 16,
                color: '#111',
                background: '#FFF',
                outline: 'none',
                width: '100%',
                boxSizing: 'border-box',
                marginBottom: 0,
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
              },
              placeholder: t(language, 'profile_password'),
              value: password,
              onChange: (e: any) => setPassword(e.target.value),
              type: 'password',
            })
          : (
            <TextInput
              style={[styles.input, { marginBottom: 0 }]}
              placeholder={t(language, 'profile_password')}
              placeholderTextColor="#AAA"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
          )}

        <TouchableOpacity style={styles.loginButton} onPress={() => {}}>
          <Text style={styles.loginButtonText}>{t(language, 'profile_login')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.helpButton} onPress={() => setShowHelp(true)}>
          <Text style={styles.helpButtonText}>? HOW TO USE</Text>
        </TouchableOpacity>
      </View>

      {/* ── Red footer ── */}
      <View style={styles.footer}>
        <View style={styles.footerInfo}>
          <Text style={styles.footerLine}>Version 0.1</Text>
          <Text style={styles.footerLine}>Futures Academy</Text>
          <Text style={styles.footerLine}>Amsterdam Netherlands</Text>
          <TouchableOpacity onPress={() => openUrl('https://www.futuresacademy.org')}>
            <Text style={[styles.footerLine, styles.footerLink]}>www.FuturesAcademy.org</Text>
          </TouchableOpacity>

          <View style={styles.footerGap} />

          <Text style={styles.footerContact}>
            <Text
              style={styles.footerContactUnderline}
              onPress={() => openUrl('mailto:info@futuresacademy.org')}
            >{t(language, 'profile_contact')}</Text>
            {t(language, 'profile_contact_suffix')}
          </Text>
        </View>

        <Image source={logo} style={styles.logo} resizeMode="contain" />
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFF',
  },

  /* ── Form section ── */
  formSection: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 20,
    justifyContent: 'center',
  },
  heading: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111',
    lineHeight: 23,
    marginBottom: 20,
  },
  input: {
    height: 56,
    borderWidth: 1.5,
    borderColor: '#111',
    borderRadius: 4,
    paddingHorizontal: 16,
    fontSize: 16,
    color: '#111',
    marginBottom: 12,
  },
  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  langLabel: {
    fontSize: 14,
    color: '#555',
    marginRight: 4,
  },
  langBtn: {
    borderWidth: 1.5,
    borderColor: '#111',
    borderRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginRight: 8,
  },
  langBtnActive: {
    backgroundColor: '#111',
  },
  langBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111',
    letterSpacing: 1,
  },
  langBtnTextActive: {
    color: '#FFF',
  },
  loginButton: {
    height: 50,
    backgroundColor: '#111',
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  loginButtonText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  helpButton: {
    height: 50,
    borderWidth: 1.5,
    borderColor: '#111',
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  helpButtonText: {
    color: '#111',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1.5,
  },

  /* ── Red footer ── */
  footer: {
    backgroundColor: '#E93440',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 20,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  footerInfo: {
    flex: 1,
    marginRight: 16,
  },
  footerLine: {
    color: '#FFF',
    fontSize: 13,
    lineHeight: 21,
  },
  footerGap: {
    height: 10,
  },
  footerLink: {
    textDecorationLine: 'underline',
  },
  footerContact: {
    color: '#FFF',
    fontSize: 13,
    lineHeight: 21,
  },
  footerContactUnderline: {
    textDecorationLine: 'underline',
  },
  logo: {
    width: 90,
    height: 90,
  },
});
